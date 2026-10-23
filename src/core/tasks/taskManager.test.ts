import { describe, expect, it } from "vitest";

import { TaskCancelledError, TaskManager } from "./taskManager";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TaskManager", () => {
  it("passe de en attente à en cours puis terminée", async () => {
    const manager = new TaskManager({ concurrency: 1, historySize: 10 });
    const gate = deferred<number>();
    const seen: string[] = [];
    manager.subscribe((tasks) => seen.push(tasks[0]?.state ?? ""));

    const { done } = manager.run({ labelKey: "task.systemInfo" }, () => gate.promise);
    expect(manager.snapshot()[0].state).toBe("running");

    gate.resolve(42);
    await expect(done).resolves.toBe(42);
    expect(manager.snapshot()[0].state).toBe("done");
    expect(seen).toEqual(["pending", "running", "done"]);
  });

  it("garde les tâches en attente tant que la file est saturée", async () => {
    const manager = new TaskManager({ concurrency: 1, historySize: 10 });
    const first = deferred();
    manager.run({ labelKey: "task.openApp", labelParams: { app: "Bloc-notes" } }, () => first.promise);
    manager.run({ labelKey: "task.systemInfo" }, async () => undefined);

    const [, second] = manager.snapshot();
    expect(second.state).toBe("pending");

    first.resolve();
    await flush();
    expect(manager.snapshot()[1].state).toBe("done");
  });

  it("enregistre l'échec avec son code d'erreur", async () => {
    const manager = new TaskManager({ concurrency: 2, historySize: 10 });
    const { done } = manager.run({ labelKey: "task.openApp", labelParams: { app: "Discord" } }, async () => {
      throw Object.assign(new Error("absent"), { code: "not-installed" });
    });

    await expect(done).rejects.toThrow("absent");
    expect(manager.snapshot()[0]).toMatchObject({ state: "error", errorCode: "not-installed" });
  });

  it("annule une tâche en cours : état immédiat, signal transmis, promesse rejetée", async () => {
    const manager = new TaskManager({ concurrency: 2, historySize: 10 });
    let receivedSignal: AbortSignal | undefined;
    const { id, done } = manager.run({ labelKey: "task.systemInfo" }, (signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    });

    expect(manager.cancel(id)).toBe(true);
    expect(manager.snapshot()[0].state).toBe("cancelled");
    expect(receivedSignal?.aborted).toBe(true);
    await expect(done).rejects.toBeInstanceOf(TaskCancelledError);
  });

  it("retire une tâche annulée de la file d'attente sans l'exécuter", async () => {
    const manager = new TaskManager({ concurrency: 1, historySize: 10 });
    const blocker = deferred();
    manager.run({ labelKey: "task.systemInfo" }, () => blocker.promise);
    let executed = false;
    const queued = manager.run({ labelKey: "task.openApp", labelParams: { app: "Paint" } }, async () => {
      executed = true;
    });

    expect(manager.cancel(queued.id)).toBe(true);
    await expect(queued.done).rejects.toBeInstanceOf(TaskCancelledError);
    blocker.resolve();
    await flush();
    expect(executed).toBe(false);
  });

  it("n'annule que les tâches annulables", () => {
    const manager = new TaskManager({ concurrency: 3, historySize: 10 });
    manager.run({ labelKey: "task.systemInfo", cancellable: false }, () => new Promise(() => {})).done.catch(() => {});
    manager.run({ labelKey: "task.openApp", labelParams: { app: "Chrome" } }, () => new Promise(() => {})).done.catch(() => {});

    expect(manager.cancelAllCancellable()).toBe(1);
    expect(manager.snapshot().map((task) => task.state)).toEqual(["running", "cancelled"]);
  });

  it("borne l'historique aux tâches terminées", async () => {
    const manager = new TaskManager({ concurrency: 2, historySize: 2 });
    for (let index = 0; index < 4; index += 1) {
      await manager.run({ labelKey: "task.systemInfo" }, async () => index).done;
    }
    expect(manager.snapshot()).toHaveLength(2);
  });
});
