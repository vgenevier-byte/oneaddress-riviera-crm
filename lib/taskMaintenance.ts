import type { Task } from "./types";

export function isCompletedTaskStatus(status: unknown) {
  return String(status || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").trim() === "termine";
}

// The clock is supplied by the state-update event. React may replay an updater.
export function maintainCompletedTasks(tasks: Task[], now: number): Task[] {
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  let changed = false;
  const result = tasks.flatMap(task => {
    if (!isCompletedTaskStatus(task.status)) return [task];
    if (!task.completedAt) {
      changed = true;
      return [{ ...task, completedAt: new Date(now).toISOString() }];
    }
    const completedTime = new Date(task.completedAt).getTime();
    if (!Number.isNaN(completedTime) && now - completedTime > threeDays) {
      changed = true;
      return [];
    }
    return [task];
  });
  return changed ? result : tasks;
}
