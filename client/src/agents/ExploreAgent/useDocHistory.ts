import { ref, computed } from "vue";
import type { DocumentSection } from "./types";

export interface SectionDiff {
  sectionId: string;
  title: string;
  oldContent: string;
  newContent: string;
  oldStatus: "empty" | "partial" | "filled";
  newStatus: "empty" | "partial" | "filled";
}

export type DocCommitSource = "代码探索" | "用户回答" | "用户编辑" | "初始化";

export interface DocCommit {
  id: string;
  timestamp: number;
  source: DocCommitSource;
  diffs: SectionDiff[];
  snapshot: DocumentSection[];
}

export function useDocHistory() {
  const commits = ref<DocCommit[]>([]);
  const pointer = ref(-1); // 指向当前 commit 的索引

  const canUndo = computed(() => pointer.value > 0);
  const canRedo = computed(() => pointer.value < commits.value.length - 1);
  const currentCommit = computed(() =>
    pointer.value >= 0 ? commits.value[pointer.value] : null
  );

  function computeDiffs(oldSections: DocumentSection[], newSections: DocumentSection[]): SectionDiff[] {
    const diffs: SectionDiff[] = [];
    for (const newSec of newSections) {
      const oldSec = oldSections.find(s => s.id === newSec.id);
      const oldContent = oldSec?.content ?? "";
      const oldStatus = oldSec?.status ?? "empty";
      if (oldContent !== newSec.content || oldStatus !== newSec.status) {
        diffs.push({
          sectionId: newSec.id,
          title: newSec.title,
          oldContent,
          newContent: newSec.content,
          oldStatus,
          newStatus: newSec.status,
        });
      }
    }
    return diffs;
  }

  function cloneSections(sections: DocumentSection[]): DocumentSection[] {
    return sections.map(s => ({ ...s }));
  }

  function initFromSections(sections: DocumentSection[]) {
    const snapshot = cloneSections(sections);
    commits.value = [{
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: "初始化",
      diffs: [],
      snapshot,
    }];
    pointer.value = 0;
  }

  function commit(
    oldSections: DocumentSection[],
    newSections: DocumentSection[],
    source: "代码探索" | "用户回答" | "用户编辑",
  ) {
    const diffs = computeDiffs(oldSections, newSections);
    if (diffs.length === 0) return;

    // 截断 redo 栈
    commits.value = commits.value.slice(0, pointer.value + 1);

    commits.value.push({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source,
      diffs,
      snapshot: cloneSections(newSections),
    });
    pointer.value = commits.value.length - 1;
  }

  function undo(): DocumentSection[] | null {
    if (!canUndo.value) return null;
    pointer.value--;
    return cloneSections(commits.value[pointer.value].snapshot);
  }

  function redo(): DocumentSection[] | null {
    if (!canRedo.value) return null;
    pointer.value++;
    return cloneSections(commits.value[pointer.value].snapshot);
  }

  return {
    commits,
    pointer,
    canUndo,
    canRedo,
    currentCommit,
    initFromSections,
    commit,
    undo,
    redo,
  };
}
