"""Make sherpa-onnx's fp16 Parakeet encoder correct on ONNX Runtime's CUDA provider.

Usage: patch-parakeet-encoder-for-cuda.py <encoder.fp16.onnx> <encoder.fp16-cuda.onnx>

Two fp16 problems show up only on CUDA (the CPU provider computes these ops in fp32):

1. ORT's SkipLayerNormFusion fuses each residual Add + LayerNormalization into a CUDA
   kernel that overflows in fp16; the encoder output is garbage. sherpa-onnx can't
   disable a single fusion, so each such LayerNorm runs in fp32 behind a Cast, which
   the fusion no longer matches.
2. The output-length arithmetic ((L - 1) / 2 + 1, three times) runs in fp16. Past 2048
   feature frames (~20 s of audio) fp16 rounds it up, sherpa decodes one frame past the
   end, and the NaN result makes sherpa-onnx-node's JSON.parse throw. That chain moves
   to fp32.
"""

import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def fp32_layer_norms(graph):
    producer = {out: node for node in graph.node for out in node.output}
    initializers = {init.name: init for init in graph.initializer}
    nodes = []
    patched = 0
    for node in graph.node:
        source = producer.get(node.input[0]) if node.input else None
        if node.op_type != "LayerNormalization" or source is None or source.op_type != "Add":
            nodes.append(node)
            continue
        patched += 1
        suffix = f"_fp32ln{patched}"
        x32 = node.input[0] + suffix + "_in"
        nodes.append(
            helper.make_node(
                "Cast", [node.input[0]], [x32], to=TensorProto.FLOAT, name=node.name + suffix + "_cin"
            )
        )
        inputs = [x32]
        for name in node.input[1:]:
            if name in initializers:
                weights = numpy_helper.to_array(initializers[name]).astype(np.float32)
                graph.initializer.append(numpy_helper.from_array(weights, name + suffix))
                inputs.append(name + suffix)
            else:
                nodes.append(
                    helper.make_node(
                        "Cast", [name], [name + suffix], to=TensorProto.FLOAT, name=node.name + suffix + "_cw"
                    )
                )
                inputs.append(name + suffix)
        y32 = node.output[0] + suffix + "_out"
        layer_norm = helper.make_node(
            "LayerNormalization", inputs, [y32, *node.output[1:]], name=node.name + suffix
        )
        layer_norm.attribute.extend(node.attribute)
        nodes.append(layer_norm)
        nodes.append(
            helper.make_node(
                "Cast", [y32], [node.output[0]], to=TensorProto.FLOAT16, name=node.name + suffix + "_cout"
            )
        )
    del graph.node[:]
    graph.node.extend(nodes)
    return patched


def fp32_length_chain(graph):
    producer = {out: node for node in graph.node for out in node.output}
    chain = set()
    pending = ["encoded_lengths"]
    while pending:
        node = producer.get(pending.pop())
        if node is None or id(node) in chain:
            continue
        chain.add(id(node))
        pending.extend(node.input)

    changed = 0
    for node in graph.node:
        if id(node) not in chain:
            continue
        if node.op_type == "Cast":
            for attr in node.attribute:
                if attr.name == "to" and attr.i == TensorProto.FLOAT16:
                    attr.i = TensorProto.FLOAT
                    changed += 1
        elif node.op_type == "Constant" and node.attribute[0].t.data_type == TensorProto.FLOAT16:
            value = node.attribute[0].t
            node.attribute[0].t.CopyFrom(
                numpy_helper.from_array(numpy_helper.to_array(value).astype(np.float32), value.name)
            )
            changed += 1

    chain_outputs = {out for node in graph.node if id(node) in chain for out in node.output}
    kept = [info for info in graph.value_info if info.name not in chain_outputs]
    del graph.value_info[:]
    graph.value_info.extend(kept)
    return changed


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    model = onnx.load(sys.argv[1])
    layer_norms = fp32_layer_norms(model.graph)
    length_nodes = fp32_length_chain(model.graph)
    if layer_norms == 0 or length_nodes == 0:
        sys.exit(
            f"Unexpected encoder graph (layer norms: {layer_norms}, length nodes: {length_nodes}); "
            "the upstream export changed, re-check the patch."
        )
    onnx.save(model, sys.argv[2])
    print(f"Patched {layer_norms} LayerNorms and {length_nodes} length nodes -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
