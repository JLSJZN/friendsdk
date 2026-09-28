#!/usr/bin/env node
// Cut a recorded take into a short video: segments between named marks ({ mark } steps of a scenario), each
// optionally sped up, joined by hard cuts or crossfades, upscaled with nearest neighbour so pixel art stays crisp,
// encoded once to H.264 (yuv420p, BT.709, faststart, no audio), plus a poster frame.
// tools/record-video.mjs runs this by itself when the scenario exports `cut`; run it by hand to re-cut a kept take:
//
//   node tools/cut-video.mjs <take.mkv|take.webm> --marks take-marks.json --scenario file.mjs --out trailer.mp4 [--poster trailer-poster.png]
//
// Cut spec, the scenario's named export `cut`:
//   { fps: 30, scale: 2, crf: 20, poster: { at: "moon", offset: 0.5 },
//     segments: [{ from: "mark", start: -0.2, to: "other mark", end: 1.5, speed: 1.5, fade: 0.3 }, ...] }
// A segment runs from marks[from] + start to marks[to ?? from] + end (seconds in the take) and plays `speed` times
// faster (default 1). `fade` crossfades into it from the previous segment for that many seconds (default: hard cut).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { loadScenario } from "./lib/runtime.mjs";

const run = promisify(execFile);

/** Resolve the segments against the marks: take in/out points, output length and where each starts in the output. */
export function planCut(cut, marks) {
  assert(Array.isArray(cut?.segments) && cut.segments.length, "The cut needs segments");
  const at = (name, offset = 0) => {
    assert(Number.isFinite(marks[name]), `No mark "${name}" in the take. Marks: ${Object.keys(marks).join(", ")}`);
    return marks[name] + offset;
  };
  let length = 0;
  return cut.segments.map((segment, index) => {
    const start = Math.max(0, at(segment.from, segment.start ?? 0)), end = at(segment.to ?? segment.from, segment.end ?? 0);
    const speed = segment.speed ?? 1, fade = index ? segment.fade ?? 0 : 0, duration = (end - start) / speed;
    assert(end > start && speed > 0, `Segment ${index + 1} (${segment.from}) is empty`);
    assert(fade < duration && (!index || fade < length), `Segment ${index + 1} (${segment.from}): fade longer than a side`);
    const outputStart = length - fade;
    length = outputStart + duration;
    return Object.freeze({ label: segment.from, start, end, speed, fade, duration, outputStart });
  });
}

/** Render the cut to `out` (and `poster`). Returns the plan with output timestamps. */
export async function renderCut({ ffmpeg = "ffmpeg", source, marks, cut, out, poster }) {
  const plan = planCut(cut, marks);
  const fps = cut.fps ?? 30, scale = cut.scale ?? 1, crf = cut.crf ?? 20;
  // Nearest neighbour in RGB first, then BT.709 limited range: every source pixel becomes a scale x scale block.
  const upscale = `scale=iw*${scale}:ih*${scale}:flags=neighbor:out_color_matrix=bt709:out_range=tv`;
  const inputs = plan.flatMap(item => ["-ss", item.start.toFixed(3), "-t", (item.end - item.start).toFixed(3), "-i", source]);
  const graph = plan.map((item, index) => `[${index}:v]setpts=(PTS-STARTPTS)/${item.speed},fps=${fps},format=gbrp,settb=1/${fps}[s${index}]`);
  let last = "s0", length = plan[0].duration;
  for (const [index, item] of plan.entries()) {
    if (!index) continue;
    const next = `j${index}`;
    graph.push(item.fade > 0
      ? `[${last}][s${index}]xfade=transition=fade:duration=${item.fade}:offset=${(length - item.fade).toFixed(3)}[${next}]`
      : `[${last}][s${index}]concat=n=2:v=1:a=0,settb=1/${fps}[${next}]`);
    length += item.duration - item.fade;
    last = next;
  }
  graph.push(`[${last}]${upscale},format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[out]`);
  await run(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-an",
    "-c:v", "libx264", "-preset", cut.preset ?? "slow", "-crf", String(crf), "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
  { maxBuffer: 1 << 24 });
  if (poster && cut.poster) {
    const at = marks[cut.poster.at] + (cut.poster.offset ?? 0);
    assert(Number.isFinite(at), `No poster mark "${cut.poster.at}"`);
    await run(ffmpeg, ["-y", "-loglevel", "error", "-ss", at.toFixed(3), "-i", source, "-frames:v", "1", "-vf", `scale=iw*${scale}:ih*${scale}:flags=neighbor`, poster]);
  }
  return plan;
}

export function describePlan(plan) {
  return plan.map(item => `${item.outputStart.toFixed(2).padStart(6)}s  ${item.label} (take ${item.start.toFixed(2)}-${item.end.toFixed(2)}s`
    + `${item.speed !== 1 ? `, x${item.speed}` : ""}${item.fade ? `, fade ${item.fade}s` : ""})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    marks: { type: "string" }, scenario: { type: "string" }, out: { type: "string" }, poster: { type: "string" }, ffmpeg: { type: "string" },
  } });
  assert(positionals[0] && values.marks && values.scenario && values.out, "Usage: node tools/cut-video.mjs <take> --marks marks.json --scenario file.mjs --out out.mp4 [--poster poster.png]");
  const { cut } = await loadScenario(values.scenario);
  assert(cut, `${values.scenario} exports no cut`);
  const plan = await renderCut({ ffmpeg: values.ffmpeg, source: resolve(positionals[0]), marks: JSON.parse(await readFile(values.marks, "utf8")),
    cut, out: resolve(values.out), poster: values.poster && resolve(values.poster) });
  for (const line of describePlan(plan)) console.log(line);
  console.log(`${values.out} (${((await stat(values.out)).size / 1024 / 1024).toFixed(2)} MB)`);
}
