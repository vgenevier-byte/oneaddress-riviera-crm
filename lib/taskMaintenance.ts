import type { Task } from "./types";

export function isCompletedTaskStatus(status: unknown) {
  return String(status || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").trim() === "termine";
}

// Compatibility for old callers: preserve history and unknown timestamps.
// Only canonical server mutations record completion transitions.
export function maintainCompletedTasks(tasks: Task[], _now?: number): Task[] { return tasks; }
