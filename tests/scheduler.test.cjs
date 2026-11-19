"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { analyzePlan, demoPlan, PlanError } = require("../dist/scheduler.js");

function task(id, duration, ...dependencies) {
  return { id, name: id, duration, dependencies };
}

function project(...tasks) {
  return { title: "Test project", version: 1, tasks };
}

test("demo shows no slip for two days and a different critical branch after three", () => {
  const plan = demoPlan();
  const baseline = analyzePlan(plan);
  assert.equal(baseline.duration, 16);
  assert.equal(baseline.timing.get("backend").slack, 2);
  assert.deepEqual(baseline.criticalPath, ["discovery", "ux", "frontend", "qa", "launch"]);
  const tied = analyzePlan(plan, { id: "backend", delay: 2 });
  assert.equal(tied.duration, 16);
  assert.equal(tied.criticalPathCount, 2);
  const slipped = analyzePlan(plan, { id: "backend", delay: 3 });
  assert.equal(slipped.duration, 17);
  assert.deepEqual(slipped.criticalPath, ["discovery", "api", "backend", "qa", "launch"]);
  assert.equal(plan.tasks.find(t => t.id === "backend").duration, 5);
});

test("disconnected branches share one finish constraint and get the right slack", () => {
  const result = analyzePlan(project(task("end", 3, "start"), task("free", 2), task("start", 4), task("parallel", 7)));
  assert.equal(result.duration, 7);
  assert.equal(result.criticalPathCount, 2);
  assert.equal(result.timing.get("end").start, 4);
  assert.equal(result.timing.get("free").latestStart, 5);
  assert.equal(result.timing.get("free").slack, 5);
});

test("a shortcut edge between two critical tasks is not a critical link", () => {
  const result = analyzePlan(project(task("a", 1), task("b", 2, "a"), task("c", 3, "a", "b")));
  assert.equal(result.criticalPathCount, 1);
  assert.equal(result.edges.find(edge => edge.from === "a" && edge.to === "c").critical, false);
});

test("cycle diagnostics name only an actual cycle, even when a downstream task comes first", () => {
  const plan = project(task("downstream", 1, "b"), task("a", 1, "c"), task("b", 1, "a"), task("c", 1, "b"));
  assert.throws(() => analyzePlan(plan), error => {
    assert.ok(error instanceof PlanError);
    assert.deepEqual(error.cycle, ["b", "c", "a", "b"]);
    assert.match(error.message, /b → c → a → b/);
    return true;
  });
  assert.throws(() => analyzePlan(project(task("self", 1, "self"))), /self → self/);
});

test("handles empty projects and rejects missing, duplicate, and invalid inputs", () => {
  const empty = analyzePlan(project());
  assert.deepEqual([empty.duration, empty.criticalPath, empty.criticalPathCount], [0, [], 0]);
  assert.throws(() => analyzePlan(project(task("a", 1, "b"))), /does not exist/);
  assert.throws(() => analyzePlan(project(task("a", 1), task("a", 1))), /valid and unique/);
  assert.throws(() => analyzePlan(project(task("a", 1.5))), /whole days/);
  assert.throws(() => analyzePlan(project(task("a", 1)), { id: "a", delay: 31 }), /whole days/);
});

test("matches exhaustive path enumeration for every DAG on four ordered vertices", () => {
  const ids = ["a", "b", "c", "d"];
  const edges = ids.flatMap((from, i) => ids.slice(i + 1).map(to => [from, to]));
  for (let mask = 0; mask < (1 << edges.length); mask++) {
    const chosen = edges.filter((_, bit) => mask & (1 << bit));
    const tasks = ids.map((id, i) => task(id, (i % 2) + 1, ...chosen.filter(([, to]) => to === id).map(([from]) => from)));
    const paths = [];
    function walk(path, weight) {
      const successors = chosen.filter(([from]) => from === path.at(-1)).map(([, to]) => to);
      if (!successors.length) paths.push({ path, weight });
      for (const next of successors) walk([...path, next], weight + tasks[ids.indexOf(next)].duration);
    }
    tasks.filter(t => !t.dependencies.length).forEach(t => walk([t.id], t.duration));
    const max = Math.max(...paths.map(p => p.weight));
    const critical = paths.filter(p => p.weight === max);
    const result = analyzePlan(project(...tasks.toReversed()));
    assert.equal(result.duration, max);
    assert.equal(result.criticalPathCount, critical.length);
    assert.ok(critical.some(path => path.path.join() === result.criticalPath.join()));
    for (const id of ids) {
      assert.equal(result.timing.get(id).critical, critical.some(path => path.path.includes(id)));
    }
  }
});
