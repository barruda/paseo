import { Icon } from "../icons";
import { Modal } from "./modal";
import { ScrollView, FlatList } from "./scroll-view";
import { TextInput } from "./text-input";
import { copyText } from "./clipboard";
import { useToast } from "./toast";
// CUSTOM(btw-actions)
import { AgentForkMenu, FollowUpComposer } from "./host-components";
import { useRevealedText } from "@/hooks/use-revealed-text";

export const pluginReactNativeRuntime = {
  Icon,
  Modal,
  ScrollView,
  FlatList,
  TextInput,
  copyText,
  useRevealedText,
  useToast,
  // CUSTOM(btw-actions)
  FollowUpComposer,
  AgentForkMenu,
};
