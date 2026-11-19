(() => {
  "use strict";

  const { analyzePlan, normalizePlan, demoPlan, MAX_TASKS } = window.Scheduler;
  const $ = id => document.getElementById(id);
  const storageKey = "critical-path-studio:project:v1";
  const names = new Intl.NumberFormat("en");
  const days = value => value === 1 ? "1 day" : value + " days";
  const short = (s, limit) => s.length > limit ? s.slice(0, limit - 1) + "…" : s;
  let storageWorks = true;
  let plan = loadPlan();
  let base = analyzePlan(plan);
  let selected = plan.tasks.find(task => task.id === "backend")?.id ?? base.order[0];
  let delay = 0;
  let view = "graph";
  let zoom = 1;
  let graphWidth = 0;
  let graphHeight = 0;
  let editing = null;
  let confirmAction;
  let toastTimer;

  function loadPlan() {
    let saved;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      storageWorks = false;
    }
    if (saved) {
      try {
        const candidate = normalizePlan(JSON.parse(saved));
        analyzePlan(candidate);
        return candidate;
      } catch {
        // Recover from a stale or invalid saved document.
      }
    }
    return demoPlan();
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(plan));
    } catch {
      storageWorks = false;
    }
    $("storage-state").textContent = storageWorks ? "Projects are saved in this browser." : "Browser storage is unavailable. Export to save your project.";
  }

  function commit(candidate, resetScenario = false) {
    const next = normalizePlan(candidate);
    const analysis = analyzePlan(next);
    plan = next;
    base = analysis;
    if (resetScenario || !base.timing.has(selected)) {
      selected = base.timing.has("backend") ? "backend" : base.order[0];
      delay = 0;
    }
    if (resetScenario) zoom = 1;
    persist();
    renderProject();
  }

  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  }

  function svgNode(tag, attrs = {}, value) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, data] of Object.entries(attrs)) el.setAttribute(name, data);
    if (value !== undefined) el.textContent = value;
    return el;
  }

  function setText(id, value) {
    $(id).textContent = value;
  }

  function showMessage(message) {
    const toast = $("toast");
    toast.hidden = false;
    toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
  }

  function renderProject() {
    setText("project-title", plan.title);
    const options = plan.tasks.map(task => new Option(task.name, task.id, false, task.id === selected));
    $("scenario-task").replaceChildren(...(options.length ? options : [new Option("No tasks yet", "")]));
    $("scenario-task").disabled = !options.length;
    $("delay").disabled = !options.length;
    $("add-task").disabled = plan.tasks.length >= MAX_TASKS;
    renderSchedule();
  }

  function renderSchedule() {
    const active = selected && delay ? analyzePlan(plan, { id: selected, delay }) : base;
    const impact = active.duration - base.duration;
    setText("baseline-days", base.duration);
    setText("baseline-unit", base.duration === 1 ? "day" : "days");
    setText("scenario-days", active.duration);
    setText("scenario-unit", active.duration === 1 ? "day" : "days");
    setText("critical-count", Array.from(active.timing.values()).filter(task => task.critical).length);
    setText("critical-unit", "of " + plan.tasks.length + (plan.tasks.length === 1 ? " task" : " tasks"));
    $("delta").hidden = !impact;
    setText("delta", "+" + days(impact));
    $("delay").value = delay;
    setText("delay-value", days(delay));
    $("clear-scenario").disabled = delay === 0;
    $("baseline-legend").hidden = !(view === "timeline" && delay);
    renderImpact(active, impact);
    if (view === "graph") renderGraph(active);
    else renderTimeline(active);
    renderTable(active);
  }

  function renderImpact(active, impact) {
    const task = base.timing.get(selected);
    let title = "No delay applied";
    let detail = "Choose a task and move the slider to test its impact.";
    if (!task) {
      title = "No tasks yet";
      detail = "Add a task to start simulating delays.";
    } else if (delay && impact) {
      title = "Deadline slips by " + days(impact);
      detail = task.name + " had " + days(task.slack) + " of slack before the delay.";
    } else if (delay) {
      title = "Deadline stays the same";
      detail = delay === task.slack
        ? task.name + " uses all its slack and becomes critical."
        : task.name + " has " + days(task.slack - delay) + " of slack left.";
    } else if (task.id === "backend" && task.slack === 2 && plan.title === "Product launch") {
      detail = "Try adding 3 days to Backend to see the critical path change.";
    }
    $("impact").classList.toggle("late", impact > 0);
    setText("impact-title", title);
    setText("impact-text", detail);
    setText("chain-title", active.criticalPathCount > 1 ? "One critical path" : "Critical path");
    setText("chain-text", active.criticalPath.length
      ? active.criticalPath.map(id => active.timing.get(id).name).join(" → ")
      : "Add tasks to see a critical path.");
    $("chain-count").hidden = active.criticalPathCount < 2;
    setText("chain-count", names.format(active.criticalPathCount) + " paths tie for the deadline.");
  }

  function layout(active) {
    const columns = [];
    for (const id of active.order) {
      const layer = active.timing.get(id).layer;
      (columns[layer] ??= []).push(id);
    }
    const positions = new Map();
    const maxRows = Math.max(...columns.map(column => column.length));
    const height = Math.max(218, maxRows * 91 + 29);
    const width = Math.max(280, columns.length * 169 - 6);
    const left = (width - ((columns.length - 1) * 169 + 131)) / 2;
    columns.forEach((column, x) => column.forEach((id, y) => {
      positions.set(id, {
        x: left + x * 169,
        y: (height - 54 - (column.length - 1) * 91) / 2 + y * 91,
      });
    }));
    return { positions, height, width };
  }

  function marker(id, color) {
    const arrow = svgNode("marker", { id, viewBox: "0 0 8 8", refX: "7.2", refY: 4, markerWidth: 6, markerHeight: 6, orient: "auto" });
    arrow.append(svgNode("path", { d: "M 0 0 L 8 4 L 0 8 z", fill: color }));
    return arrow;
  }

  function renderGraph(active) {
    const container = $("graph-graphic");
    const scroll = $("graph-scroll");
    const { scrollLeft, scrollTop } = scroll;
    $("zoom-controls").hidden = !active.order.length;
    if (!active.order.length) {
      container.replaceChildren(node("p", "empty", "Add a task to draw the dependency graph."));
      return;
    }
    const { positions, width, height } = layout(active);
    graphWidth = width;
    graphHeight = height;
    const chart = svgNode("svg", { viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": "Dependency graph. Select a task to edit it." });
    const defs = svgNode("defs");
    defs.append(marker("edge-arrow", "#a1a8c4"), marker("critical-arrow", "#7050db"));
    chart.append(defs);
    const edges = [...active.edges].sort((a, b) => Number(a.critical) - Number(b.critical));
    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      const x = from.x + 131;
      const y = from.y + 27;
      const tx = to.x - 3;
      const ty = to.y + 27;
      const bend = (x + tx) / 2;
      const path = "M " + x + " " + y + " C " + bend + " " + y + ", " + bend + " " + ty + ", " + tx + " " + ty;
      chart.append(svgNode("path", { d: path, class: "edge" + (edge.critical ? " is-critical" : ""), "marker-end": edge.critical ? "url(#critical-arrow)" : "url(#edge-arrow)", "aria-hidden": "true" }));
    }
    for (const id of active.order) {
      const task = active.timing.get(id);
      const pos = positions.get(id);
      const activeTarget = delay > 0 && id === selected;
      const metrics = days(task.duration) + (task.critical ? ", critical" : ", " + days(task.slack) + " of slack");
      const group = svgNode("g", { class: "graph-node", transform: "translate(" + pos.x + "," + pos.y + ")", role: "button", tabindex: 0, "aria-label": "Edit " + task.name + ", " + metrics });
      group.append(svgNode("title", {}, task.name + " · " + metrics));
      group.append(svgNode("rect", { width: 131, height: 54, rx: 10, class: "node-body" + (task.critical ? " is-critical" : "") + (activeTarget ? " is-target" : "") }));
      if (task.critical) group.append(svgNode("rect", { x: 0, y: 11, width: 3, height: 32, rx: 2, class: "node-rail" }));
      group.append(
        svgNode("text", { x: 11, y: 22, class: "node-name" }, short(task.name, 15)),
        svgNode("text", { x: 11, y: 40, class: "node-detail" }, task.duration + "d · " + (task.critical ? "Critical" : task.slack + "d slack")),
      );
      group.addEventListener("click", () => editTask(id));
      group.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editTask(id);
        }
      });
      chart.append(group);
    }
    container.replaceChildren(chart);
    resizeGraph();
    scroll.scrollLeft = scrollLeft;
    scroll.scrollTop = scrollTop;
  }

  function resizeGraph() {
    const chart = $("graph-graphic").querySelector("svg");
    if (!chart || view !== "graph") return;
    const available = $("graph-scroll").clientWidth - 26;
    const fit = Math.min(1.12, Math.max(.68, available / graphWidth));
    const scale = fit * zoom;
    chart.setAttribute("width", Math.round(graphWidth * scale));
    chart.setAttribute("height", Math.round(graphHeight * scale));
    $("zoom-in").disabled = zoom >= 2;
    $("zoom-out").disabled = zoom <= .6;
  }

  function formatPercent(day, horizon) {
    return (day / horizon * 100) + "%";
  }

  function renderTimeline(active) {
    const timeline = $("timeline");
    if (!active.order.length) {
      timeline.replaceChildren(node("p", "empty", "Add a task to see its start and finish."));
      return;
    }
    const { scrollLeft, scrollTop } = timeline;
    const wrapper = node("div", "timeline-inner");
    const axis = node("div", "timeline-axis");
    const step = Math.max(1, Math.ceil(active.duration / 6));
    const end = step * Math.ceil(active.duration / step);
    for (let day = 0; day <= end; day += step) {
      const tick = node("span", "timeline-tick", "Day " + day);
      tick.style.left = formatPercent(day, end);
      axis.append(tick);
    }
    wrapper.append(node("div", "timeline-label", "Task"), axis);
    for (const taskId of active.order) {
      const task = active.timing.get(taskId);
      const label = node("div", "timeline-label");
      const button = node("button", "", task.name);
      button.type = "button";
      button.addEventListener("click", () => editTask(taskId));
      label.append(button);
      const track = node("div", "timeline-track");
      track.style.backgroundSize = formatPercent(step, end) + " 100%";
      const bar = node("div", "timeline-bar" + (task.critical ? " is-critical" : ""));
      bar.style.left = formatPercent(task.start, end);
      bar.style.width = formatPercent(task.duration, end);
      bar.title = task.name + ": day " + task.start + " to " + task.finish;
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", bar.title);
      track.append(bar);
      if (delay) {
        const baseline = node("div", "timeline-baseline");
        baseline.style.left = formatPercent(base.duration, end);
        track.append(baseline);
      }
      wrapper.append(label, track);
    }
    timeline.replaceChildren(wrapper);
    timeline.scrollLeft = scrollLeft;
    timeline.scrollTop = scrollTop;
  }

  function renderTable(active) {
    const target = $("task-rows");
    if (!active.order.length) {
      const row = node("tr");
      const cell = node("td", "empty", "No tasks yet. Add a task to get started.");
      cell.colSpan = 7;
      row.append(cell);
      target.replaceChildren(row);
      return;
    }
    const rows = active.order.map(id => {
      const task = active.timing.get(id);
      const row = node("tr");
      const name = node("th");
      name.scope = "row";
      const label = node("span", "task-name");
      const suffix = task.critical ? " is-critical" : "";
      label.append(node("span", "task-dot" + suffix), node("span", "", task.name));
      name.append(label);
      const edit = node("button", "button secondary task-edit", "Edit");
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit task " + task.name);
      edit.addEventListener("click", () => editTask(id));
      const editCell = node("td");
      editCell.append(edit);
      const dependencies = task.dependencies.map(dep => active.timing.get(dep).name).join(", ");
      const depCell = node("td", "", short(dependencies, 42) || "—");
      if (dependencies) depCell.title = dependencies;
      row.append(name, node("td", "", days(task.duration)), node("td", "", task.start), node("td", "", task.finish),
        node("td", "slack" + suffix, task.critical ? "0 days · Critical" : days(task.slack)), depCell, editCell);
      return row;
    });
    target.replaceChildren(...rows);
  }

  function switchView(next, focus = false) {
    view = next;
    const showGraph = view === "graph";
    for (const [name, on] of [["graph", showGraph], ["gantt", !showGraph]]) {
      const tab = $(name + "-tab");
      tab.setAttribute("aria-selected", on);
      tab.tabIndex = on ? 0 : -1;
      $(name + "-panel").hidden = !on;
      if (on && focus) tab.focus();
    }
    setText("view-description", showGraph ? "Follow the dependencies between tasks." : "Compare start times, durations, and finish days.");
    setText("other-legend", showGraph ? "Other dependencies" : "Other tasks");
    renderSchedule();
  }

  function showError(id, error) {
    $(id).textContent = error.message;
    $(id).hidden = false;
  }

  function editTask(id = null) {
    editing = id;
    const existing = plan.tasks.find(task => task.id === editing);
    setText("task-dialog-title", existing ? "Edit task" : "Add task");
    $("task-name").value = existing?.name ?? "";
    $("task-duration").value = existing?.duration ?? 1;
    $("task-error").hidden = true;
    $("delete-task").hidden = !existing;
    const choices = plan.tasks.filter(task => task.id !== editing).map(task => {
      const label = node("label", "check");
      const check = node("input");
      check.type = "checkbox";
      check.value = task.id;
      check.checked = existing?.dependencies.includes(task.id) ?? false;
      label.append(check, node("span", "", task.name));
      return label;
    });
    $("dep-choices").replaceChildren(...(choices.length ? choices : [node("p", "slack", "No other tasks yet.")]));
    $("task-dialog").showModal();
    $("task-name").focus();
  }

  function confirm(title, detail, label, handler) {
    setText("confirm-title", title);
    setText("confirm-detail", detail);
    setText("confirm-action", label);
    confirmAction = handler;
    $("confirm-dialog").showModal();
  }

  function saveTask(event) {
    event.preventDefault();
    const task = {
      id: editing ?? "task-" + (crypto.randomUUID?.() ?? Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
      name: $("task-name").value,
      duration: Number($("task-duration").value),
      dependencies: Array.from($("dep-choices").querySelectorAll(":checked"), check => check.value),
    };
    const tasks = editing ? plan.tasks.map(item => item.id === editing ? task : item) : [...plan.tasks, task];
    try {
      commit({ ...plan, tasks });
      $("task-dialog").close();
      $("add-task").focus();
      showMessage(editing ? "Task updated." : "Task added.");
    } catch (error) {
      showError("task-error", error);
    }
  }

  function deleteTask() {
    const id = editing;
    const task = base.timing.get(id);
    confirm("Delete " + task.name + "?", "The task and its dependency links will be removed.", "Delete task", () => {
      const tasks = plan.tasks.filter(item => item.id !== id).map(item => ({
        ...item, dependencies: item.dependencies.filter(dep => dep !== id),
      }));
      commit({ ...plan, tasks });
      $("task-dialog").close();
      $("add-task").focus();
      showMessage("Task deleted.");
    });
  }

  async function importProject() {
    const input = $("import-file");
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error("Project files must be smaller than 250 KB.");
      const candidate = normalizePlan(JSON.parse(await file.text()));
      analyzePlan(candidate);
      confirm("Import " + candidate.title + "?", "This will replace the project currently open. Export it first if you want to keep a copy.", "Import project", () => {
        commit(candidate, true);
        showMessage("Project imported.");
      });
    } catch (error) {
      showMessage("Import failed. " + (error instanceof SyntaxError ? "Choose a valid JSON file." : error.message));
    }
  }

  function exportProject() {
    const data = new Blob([JSON.stringify(plan, null, 2) + "\n"], { type: "application/json" });
    const link = node("a");
    link.href = URL.createObjectURL(data);
    link.download = (plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project") + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showMessage("Project exported.");
  }

  $("task-form").addEventListener("submit", saveTask);
  $("delete-task").addEventListener("click", deleteTask);
  $("add-task").addEventListener("click", () => editTask());
  $("rename-project").addEventListener("click", () => {
    $("project-name").value = plan.title;
    $("name-error").hidden = true;
    $("name-dialog").showModal();
    $("project-name").select();
  });
  $("name-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      commit({ ...plan, title: $("project-name").value });
      $("name-dialog").close();
      showMessage("Project renamed.");
    } catch (error) {
      showError("name-error", error);
    }
  });
  $("confirm-action").addEventListener("click", () => {
    const handler = confirmAction;
    $("confirm-dialog").close();
    handler?.();
  });
  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => $(button.dataset.close).close());
  });
  $("reset-demo").addEventListener("click", () => {
    confirm("Load the demo project?", "This will replace the project currently open. Export it first if you want to keep a copy.", "Load demo", () => {
      commit(demoPlan(), true);
      showMessage("Demo project loaded.");
    });
  });
  $("new-project").addEventListener("click", () => {
    confirm("Start a new project?", "This will replace the project currently open. Export it first if you want to keep a copy.", "Start project", () => {
      commit({ version: 1, title: "Untitled project", tasks: [] }, true);
      $("rename-project").click();
    });
  });
  $("import-button").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", importProject);
  $("export-button").addEventListener("click", exportProject);
  $("scenario-task").addEventListener("change", event => {
    selected = event.target.value;
    delay = 0;
    renderSchedule();
  });
  $("delay").addEventListener("input", event => {
    delay = Number(event.target.value);
    renderSchedule();
  });
  $("clear-scenario").addEventListener("click", () => {
    delay = 0;
    renderSchedule();
    $("delay").focus();
  });
  for (const [tab, next] of [["graph-tab", "graph"], ["gantt-tab", "timeline"]]) {
    $(tab).addEventListener("click", () => switchView(next));
    $(tab).addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      switchView(event.key === "Home" || (event.key !== "End" && view === "timeline") ? "graph" : "timeline", true);
    });
  }
  $("zoom-out").addEventListener("click", () => { zoom = Math.max(.6, zoom / 1.2); resizeGraph(); });
  $("zoom-in").addEventListener("click", () => { zoom = Math.min(2, zoom * 1.2); resizeGraph(); });
  $("zoom-fit").addEventListener("click", () => {
    zoom = 1;
    resizeGraph();
    $("graph-scroll").scrollTo(0, 0);
  });
  new ResizeObserver(resizeGraph).observe($("graph-scroll"));
  if (!storageWorks) setText("storage-state", "Browser storage is unavailable. Export to save your project.");
  renderProject();
})();
