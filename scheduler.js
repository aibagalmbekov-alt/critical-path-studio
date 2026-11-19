(function (root) {
  "use strict";

  const MAX_TASKS = 40;
  const MAX_DURATION = 365;
  const MAX_DELAY = 30;

  class PlanError extends Error {
    constructor(message, cycle = []) {
      super(message);
      this.name = "PlanError";
      this.cycle = cycle;
    }
  }

  function cleanText(value, maxLength, label) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
      throw new PlanError(label + " must have 1–" + maxLength + " characters.");
    }
    return value.trim();
  }

  function normalizePlan(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.tasks)) {
      throw new PlanError("Expected a version 1 project file with a tasks array.");
    }
    if (input.tasks.length > MAX_TASKS) {
      throw new PlanError("A project can have up to " + MAX_TASKS + " tasks.");
    }
    const title = cleanText(input.title, 60, "Project name");
    const ids = new Set();
    const tasks = input.tasks.map((task, index) => {
      if (!task || typeof task !== "object") throw new PlanError("Invalid task at row " + (index + 1) + ".");
      const id = task.id;
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
        throw new PlanError("Task IDs must be valid and unique.");
      }
      ids.add(id);
      const name = cleanText(task.name, 45, "Task name");
      if (!Number.isInteger(task.duration) || task.duration < 1 || task.duration > MAX_DURATION) {
        throw new PlanError(name + " needs a duration of 1–" + MAX_DURATION + " whole days.");
      }
      if (!Array.isArray(task.dependencies) || new Set(task.dependencies).size !== task.dependencies.length) {
        throw new PlanError(name + " has invalid or duplicate dependencies.");
      }
      return { id, name, duration: task.duration, dependencies: [...task.dependencies] };
    });
    for (const task of tasks) {
      if (task.dependencies.some(id => !ids.has(id))) {
        throw new PlanError(task.name + " depends on a task that does not exist.");
      }
    }
    return { version: 1, title, tasks };
  }

  function findCycle(ids, incoming, remaining) {
    const visited = new Map();
    const walk = [];
    let cursor = ids.find(id => remaining.get(id) > 0);
    while (!visited.has(cursor)) {
      visited.set(cursor, walk.length);
      walk.push(cursor);
      // Every node left by Kahn's algorithm has a predecessor in the residue.
      cursor = incoming.get(cursor).find(id => remaining.get(id) > 0);
    }
    return [cursor, ...walk.slice(visited.get(cursor) + 1).reverse(), cursor];
  }

  function analyzePlan(input, scenario = null) {
    const plan = normalizePlan(input);
    const byId = new Map(plan.tasks.map(task => [task.id, task]));
    if (scenario && (!byId.has(scenario.id) || !Number.isInteger(scenario.delay) ||
        scenario.delay < 0 || scenario.delay > MAX_DELAY)) {
      throw new PlanError("Choose a task and a delay of 0–" + MAX_DELAY + " whole days.");
    }
    const ids = Array.from(byId.keys());
    const incoming = new Map(plan.tasks.map(task => [task.id, task.dependencies]));
    const outgoing = new Map(ids.map(id => [id, []]));
    const remaining = new Map(ids.map(id => [id, incoming.get(id).length]));
    const timing = new Map();
    for (const task of plan.tasks) {
      for (const predecessor of task.dependencies) outgoing.get(predecessor).push(task.id);
      const delay = scenario?.id === task.id ? scenario.delay : 0;
      timing.set(task.id, {
        ...task, duration: task.duration + delay, layer: 0, start: 0, finish: 0,
        latestStart: 0, latestFinish: 0, slack: 0, critical: false,
      });
    }

    const order = ids.filter(id => remaining.get(id) === 0);
    let duration = 0;
    for (let index = 0; index < order.length; index++) {
      const id = order[index];
      const task = timing.get(id);
      task.finish = task.start + task.duration;
      duration = Math.max(duration, task.finish);
      for (const next of outgoing.get(id)) {
        const successor = timing.get(next);
        successor.start = Math.max(successor.start, task.finish);
        successor.layer = Math.max(successor.layer, task.layer + 1);
        remaining.set(next, remaining.get(next) - 1);
        if (remaining.get(next) === 0) order.push(next);
      }
    }
    if (order.length !== ids.length) {
      const cycle = findCycle(ids, incoming, remaining);
      throw new PlanError("Dependency cycle: " + cycle.map(id => byId.get(id).name).join(" → ") + ".", cycle);
    }

    for (let index = order.length - 1; index >= 0; index--) {
      const id = order[index];
      const task = timing.get(id);
      task.latestFinish = duration;
      for (const next of outgoing.get(id)) {
        task.latestFinish = Math.min(task.latestFinish, timing.get(next).latestStart);
      }
      task.latestStart = task.latestFinish - task.duration;
      task.slack = task.latestStart - task.start;
      task.critical = task.slack === 0;
    }

    const criticalEdges = new Map(ids.map(id => [id, []]));
    const edges = [];
    const pathsEndingAt = new Map();
    let criticalPathCount = 0;
    for (const id of order) {
      const task = timing.get(id);
      let paths = task.critical && !task.dependencies.length ? 1 : 0;
      for (const from of task.dependencies) {
        const previous = timing.get(from);
        const critical = previous.critical && task.critical && previous.finish === task.start;
        edges.push({ from, to: id, critical });
        if (critical) {
          criticalEdges.get(from).push(id);
          paths += pathsEndingAt.get(from);
        }
      }
      pathsEndingAt.set(id, paths);
      if (!outgoing.get(id).length) criticalPathCount += paths;
    }

    // Show one complete chain; the graph highlights the union of all tied chains.
    const criticalPath = [];
    let cursor = order.find(id => timing.get(id).critical && !incoming.get(id).length);
    while (cursor !== undefined) {
      criticalPath.push(cursor);
      cursor = criticalEdges.get(cursor)[0];
    }
    return { duration, order, timing, edges, criticalPath, criticalPathCount };
  }

  function demoPlan() {
    return {
      version: 1,
      title: "Product launch",
      tasks: [
        { id: "discovery", name: "Discovery", duration: 2, dependencies: [] },
        { id: "ux", name: "UX design", duration: 4, dependencies: ["discovery"] },
        { id: "api", name: "API design", duration: 3, dependencies: ["discovery"] },
        { id: "frontend", name: "Frontend", duration: 6, dependencies: ["ux"] },
        { id: "backend", name: "Backend", duration: 5, dependencies: ["api"] },
        { id: "qa", name: "QA testing", duration: 3, dependencies: ["frontend", "backend"] },
        { id: "docs", name: "Documentation", duration: 2, dependencies: ["frontend"] },
        { id: "launch", name: "Launch", duration: 1, dependencies: ["qa", "docs"] },
      ],
    };
  }

  const api = { analyzePlan, normalizePlan, demoPlan, PlanError, MAX_TASKS, MAX_DURATION, MAX_DELAY };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Scheduler = api;
})(globalThis);
