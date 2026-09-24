import { AudioLines, Image, MessageCircleQuestionMark, MonitorPlay, SquareText } from "@lucide/svelte";
import type { StepType } from "./domain/schema";

interface StepTypes {
    type: StepType;
    label: string;
    icon: typeof SquareText;
}

export const STEP_TYPES: StepTypes[] = [
  { type: "text", label: "Text", icon: SquareText },
  { type: "question", label: "Otázka", icon: MessageCircleQuestionMark },
  { type: "image", label: "Obrázek", icon: Image },
  { type: "video", label: "Video", icon: MonitorPlay },
  { type: "audio", label: "Audio", icon: AudioLines },
];

export const CARD_STATUSES = [
  { value: "draft", label: "Koncept" },
  { value: "private", label: "Soukromé" },
  { value: "locked", label: "Zamčeno" },
  { value: "approved", label: "Schváleno" },
];