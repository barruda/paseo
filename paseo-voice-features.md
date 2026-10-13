# Paseo voice recognition and speech features

Report date: 2026-10-13. Scope: the implementation in this checkout, with a separate snapshot of the personal daemon observed during this session. Defaults and runtime measurements can change between builds.

## Architecture

Paseo handles audio independently of the coding provider. Claude Code, Codex, or another selected agent receives text and performs the reasoning and coding. Selecting voice mode does not select another coding model.

```text
Microphone → Paseo audio transport → speech detection and recognition
           → transcript → active coding agent → Paseo speak tool
           → speech synthesis → client audio playback
```

The daemon owns speech processing. “Local” means the machine running the daemon, which may differ from the phone or desktop recording the microphone.

## User-facing modes

| Mode               | Input handling                                                                                                | Response handling                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Dictation          | Converts recorded speech into composer text; the user can review it or use the send-after-transcription flow. | Normal agent chat.                                          |
| Voice conversation | Detects speech boundaries, finalizes a transcript, and forwards it to the active agent.                       | The agent calls `speak`; Paseo synthesizes and plays audio. |

Voice mode updates the agent's instructions and reloads its session. The instructions request concise spoken replies, acknowledgment before work, and spoken progress updates. Spoken input is also wrapped with an instruction to answer through `speak`. This applies to the existing conversation rather than a separate speech reasoning model.

Sources: [voice session](packages/server/src/server/session/voice/voice-session.ts), [voice instructions](packages/server/src/server/voice-config.ts), [session integration](packages/server/src/server/session.ts).

## Local recognition techniques

### Models and execution

| Role                                   | Default                                                        | Alternative in the local catalog                                                               |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Dictation and voice speech recognition | `parakeet-tdt-0.6b-v2-int8` — English, offline NeMo transducer | `parakeet-tdt-0.6b-v3-int8` — catalog describes 25 European languages with automatic detection |
| Speech activity detection              | Bundled Silero VAD ONNX model                                  | No alternative local detector exposed by this implementation                                   |
| Speech synthesis                       | `kokoro-en-v0_19`                                              | No other local TTS model in this catalog                                                       |

Recognition loads separate INT8 ONNX encoder, decoder, and joiner files plus a token vocabulary. The runtime uses sherpa-onnx. Local recognition defaults to CPU execution with two threads; local Kokoro explicitly uses CPU and defaults to two threads. Silero uses CPU with one thread. The NVIDIA name on Parakeet does not imply CUDA execution.

Sources: [model catalog](packages/server/src/server/speech/providers/local/sherpa/model-catalog.ts), [recognizer](packages/server/src/server/speech/providers/local/sherpa/sherpa-offline-recognizer.ts), [worker](packages/server/src/server/speech/providers/local/worker-process.ts), [Kokoro synthesis](packages/server/src/server/speech/providers/local/sherpa/sherpa-tts.ts).

### Partial transcription from an offline model

The local realtime transcription adapter accumulates PCM16 audio and repeatedly decodes the accumulated segment using the offline recognizer. Its default minimum decode interval is 350 ms. Changed text produces a partial transcript; committing the segment requests a final decode and emits a final transcript.

Before decoding, PCM16 becomes floating-point samples. Quiet input receives peak-based gain toward 0.6, capped at 50×. This is amplitude normalization, not a dedicated noise-removal model. The adapter clears its accumulated audio between committed segments.

Repeated decoding provides live text through an offline model, with compute cost increasing as the buffered segment grows. The interval is a scheduling parameter, not a guaranteed end-to-end latency.

Source: [Parakeet realtime adapter](packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts).

### Speech boundaries and turn-taking

Speech detection is separate from transcription. Silero processes 16 kHz audio in 512-sample windows, approximately 32 ms each. Its default probability threshold is 0.5. Paseo adds a boundary state machine with these defaults:

| Parameter                       | Default  | Purpose                                                 |
| ------------------------------- | -------- | ------------------------------------------------------- |
| Speech confirmation             | 800 ms   | Confirms speech before raising the speech-start event.  |
| End-of-speech silence           | 1,000 ms | Allows a pause before finishing the spoken turn.        |
| Silero internal minimum speech  | 100 ms   | Keeps the underlying detector responsive.               |
| Silero internal minimum silence | 200 ms   | Lets Paseo's own state machine control turn boundaries. |

The controller resamples client PCM to the rates required by detection and recognition. It tracks transcript segments, assembles final text in committed order, and waits up to 10 seconds for final transcription. It suppresses filler-only partial notifications and carries confidence metadata when the provider supplies it. The voice session discards transcripts flagged as low confidence.

These are acoustic speech/silence boundaries. This implementation does not use a separate language model to judge whether a sentence or thought is complete.

Sources: [Silero session](packages/server/src/server/speech/providers/local/sherpa/silero-vad-session.ts), [turn controller](packages/server/src/server/session/voice/voice-turn-controller.ts).

### Interruption

Confirmed speech starts interruption handling before transcription completes. The voice session can interrupt the running agent and abort active voice output. This allows the user to speak over a response without waiting for recognition of the complete utterance. The speech-confirmation delay still applies.

Source: [voice session](packages/server/src/server/session/voice/voice-session.ts), particularly speech-start callbacks and voice abort handling.

## OpenAI speech option

Recognition and synthesis can use OpenAI endpoints independently of the coding provider. Claude Code can therefore use OpenAI speech, while Codex can use local speech.

The OpenAI recognition implementation calls the audio transcription endpoint. Its model fallback is `whisper-1`; it also recognizes configuration for `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`, including token log probabilities for confidence filtering. The default average-log-probability threshold is −3.0. The synthesis implementation defaults to `tts-1` and supports `tts-1-hd` in its declared model type.

These are facts about Paseo's implementation, not a survey of currently available OpenAI models. This path is not an OpenAI Realtime speech-to-speech reasoning session.

Sources: [OpenAI recognition](packages/server/src/server/speech/providers/openai/stt.ts), [OpenAI synthesis](packages/server/src/server/speech/providers/openai/tts.ts), [OpenAI configuration](packages/server/src/server/speech/providers/openai/config.ts).

## Configuration and resource lifecycle

Persisted settings distinguish `features.dictation.stt`, `features.voiceMode.stt`, and `features.voiceMode.tts`. Local model selection can be overridden through:

| Environment variable               | Setting                                   |
| ---------------------------------- | ----------------------------------------- |
| `PASEO_DICTATION_LOCAL_STT_MODEL`  | Dictation recognition model               |
| `PASEO_VOICE_LOCAL_STT_MODEL`      | Voice conversation recognition model      |
| `PASEO_VOICE_LOCAL_TTS_MODEL`      | Voice synthesis model                     |
| `PASEO_VOICE_LOCAL_TTS_SPEAKER_ID` | Kokoro speaker selection; default ID is 0 |
| `PASEO_VOICE_LOCAL_TTS_SPEED`      | Synthesis speed                           |
| `PASEO_LOCAL_MODELS_DIR`           | Local model storage directory             |

Environment model overrides precede persisted model selections. The default model directory is `$PASEO_HOME/models/local-speech`. Missing local models can download in the background. Native inference runs in a separate local speech worker, with recognizers created on demand and cached by configuration. The worker client manages shutdown when idle.

Sources: [local configuration](packages/server/src/server/speech/providers/local/config.ts), [speech runtime](packages/server/src/server/speech/speech-runtime.ts), [worker client](packages/server/src/server/speech/providers/local/worker-client.ts).

## Privacy and operational checks

With local speech providers, recognition and synthesis run on the daemon host. The transcript still goes to the selected coding provider under that provider's configuration. With remote speech providers, audio or synthesis text also goes to the configured speech endpoint. Daemon logs may include recognized text; treat them accordingly.

To identify the most recently spawned worker and selected models:

```bash
rg 'Local speech worker spawned' ~/.paseo/daemon.log | tail -1
```

To inspect current worker memory and CPU:

```bash
ps -C 'Paseo Voice' -o pid,comm,rss,%cpu
top -p "$(pgrep -x 'Paseo Voice' | paste -sd,)"
```

Run `top` only if a worker exists. RSS is resident RAM in KiB, including models and runtime overhead. A spawned worker alone does not prove every configured model has initialized. Successful transcription or playback verifies its corresponding path; installed model files alone do not prove residency.

To monitor NVIDIA GPU memory:

```bash
watch -n 1 nvidia-smi
```

Local speech inference uses CPU in this implementation and does not allocate model VRAM. Electron rendering may still appear as Paseo GPU usage.

During the earlier inspection on 2026-10-13, the personal daemon selected local Parakeet v2 and Kokoro. Its `Paseo Voice` worker, PID 221852, had approximately 1.05 GiB RSS and did not appear in NVIDIA's GPU process list. This is a process snapshot, not a model-specific memory benchmark or a permanent PID. The personal config had no explicit dictation or voice-mode feature overrides; the daemon's reconciliation logs confirmed local providers for that running instance.

## Validation limits

This report is based on repository source inspection and the earlier read-only runtime checks. No recognition accuracy benchmark, multilingual recording test, latency benchmark, or per-model memory profiling was performed. No daemon restart or configuration change was needed.
