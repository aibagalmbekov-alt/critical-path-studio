# Critical Path Studio

A browser-based project planner that uses the Critical Path Method to show which tasks control a deadline and how a delay can shift it.

## Try it

Open `dist/index.html` in a modern browser, or run `npm start` with Node.js 22+ and visit the printed local URL. No packages need to be installed. For a portable copy with all assets embedded, run `npm run bundle`.

The demo starts with an eight-task product launch that takes 16 days. Select **Backend** in the delay simulator and add **2 days**. Both paths are now critical, but the finish is unchanged. Add **3 days** instead. The Backend branch controls the finish and the launch moves to **day 17**. Switch to **Timeline** to see the simulated schedule against the baseline finish.

- Click a graph node or a task's **Edit** button to change its duration and prerequisites.
- Use **New project** for a blank plan or **Load demo** to restore the product launch.
- The editor and importer reject cycles and show the loop in dependency order.
- Use **Export** to save the baseline project as versioned JSON and **Import** to reopen it. Baseline edits are also saved in browser storage where available. Simulation settings are temporary.
- To publish the demo with a static host, serve the contents of `dist/`. It works from a subdirectory, including a GitHub Pages project site.

## How it works

`dist/scheduler.js` is a pure JavaScript scheduler shared by the browser and the Node test suite. It validates the project and uses Kahn’s algorithm to order the task graph. A forward pass accumulates the earliest possible start of each task. A reverse pass computes the latest start that preserves the overall deadline. The difference is total slack. A critical dependency connects two zero-slack tasks when the successor starts as soon as its predecessor finishes.

The scheduler counts all tied critical paths in topological order and returns one representative path for display. It processes every vertex and dependency a constant number of times, taking **O(V + E)** time and space per calculation. When topological sorting cannot finish, it follows unfinished predecessors to report a concrete cycle. The graph uses topological layers, and the timeline uses the same calculated task timings. The simulator runs the scheduler again with one longer task and compares the result to the baseline.

The project uses whole days, finish-to-start dependencies, and one project deadline. It supports up to 40 tasks, with no resource constraints or working-day calendar.

## Verify

```sh
npm test
```

The suite checks the demo branch switch, disconnected tasks, tied paths, invalid dependencies, and cycle diagnostics. It also compares the scheduler to exhaustive path enumeration on all 64 possible directed acyclic graphs with four vertices in a fixed topological order.
