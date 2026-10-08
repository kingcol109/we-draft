// server/broadcast-worker/framePump.js
//
// Turns the screencast's "a frame whenever the page repaints" into exactly
// `fps` frames per second of wall-clock time. Every 1/fps it writes the
// newest frame to the encoder — the same frame again if nothing changed —
// so FFmpeg's frame-count timestamps always track real time. If the event
// loop runs late it catches up with repeats instead of falling behind.
//
// If the encoder can't keep up (its stdin backs up past maxBacklogBytes),
// frames are dropped rather than buffered without limit; `dropped` > 0
// means this machine can't sustain the stream.
const { performance } = require("perf_hooks");

class FramePump {
  constructor({ fps, sink, maxBacklogBytes = 64 * 1024 * 1024 }) {
    this.frameMs = 1000 / fps;
    this.sink = sink; // { write(buf), backlog() }
    this.maxBacklogBytes = maxBacklogBytes;
    this.latest = null;
    this.fresh = false;
    this.running = false;
    this.timer = null;
    this.c = { source: 0, written: 0, unique: 0, catchup: 0, dropped: 0, maxLateMs: 0 };
  }

  push(buf) {
    this.latest = buf;
    this.fresh = true;
    this.c.source++;
  }

  start() {
    if (!this.latest) throw new Error("FramePump started without a first frame");
    this.running = true;
    this.t0 = performance.now();
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  tick = () => {
    if (!this.running) return;
    const now = performance.now();
    const due = Math.floor((now - this.t0) / this.frameMs) + 1;
    let n = due - this.c.written;
    if (n > 1) {
      this.c.catchup += n - 1;
      this.c.maxLateMs = Math.max(this.c.maxLateMs, now - (this.t0 + this.c.written * this.frameMs));
    }
    for (; n > 0; n--) {
      if (this.sink.backlog() > this.maxBacklogBytes) this.c.dropped++;
      else {
        this.sink.write(this.latest);
        if (this.fresh) { this.c.unique++; this.fresh = false; this.countSecond(now); }
      }
      this.c.written++;
    }
    const next = this.t0 + this.c.written * this.frameMs;
    this.timer = setTimeout(this.tick, Math.max(0, next - performance.now()));
  };

  // New frames per wall-clock second; the busiest second shows whether
  // animations get a fresh frame on every tick (= fps) or are repeating.
  countSecond(now) {
    const sec = Math.floor((now - this.t0) / 1000);
    if (sec !== this.sec) { this.sec = sec; this.inSec = 0; }
    this.peak = Math.max(this.peak || 0, ++this.inSec);
  }

  // The busiest second since the last call.
  takePeak() {
    const p = this.peak || 0;
    this.peak = 0;
    return p;
  }

  counters() {
    return { ...this.c };
  }
}

module.exports = { FramePump };
