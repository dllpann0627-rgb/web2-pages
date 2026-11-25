"use strict";

class FuelMap {
  constructor(view, selectStation) {
    this.view = view;
    this.canvas = view.querySelector("canvas");
    this.context = this.canvas.getContext("2d");
    this.layer = view.querySelector("#markers");
    this.selectStation = selectStation;
    this.markers = [];
    this.projection = Math.cos(36 * Math.PI / 180);
    new ResizeObserver(() => this.resize()).observe(view);
    view.querySelector("#zoom-in").onclick = () => this.zoom(1.5);
    view.querySelector("#zoom-out").onclick = () => this.zoom(1 / 1.5);
    view.querySelector("#reset-map").onclick = () => this.fit();
    view.addEventListener("wheel", event => {
      if (!this.bounds) return;
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      this.zoom(event.deltaY < 0 ? 1.25 : 0.8, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    view.addEventListener("pointerdown", event => {
      if (!this.bounds || event.button !== 0 || event.target.closest("button")) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      view.setPointerCapture(event.pointerId);
      view.classList.add("dragging");
    });
    view.addEventListener("pointermove", event => {
      if (event.pointerId !== this.drag?.id) return;
      this.move(event.clientX - this.drag.x, event.clientY - this.drag.y);
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
    });
    view.addEventListener("lostpointercapture", () => {
      this.drag = null;
      view.classList.remove("dragging");
    });
    view.addEventListener("keydown", event => {
      if (event.target !== view) return;
      const offsets = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (offsets[event.key]) this.move(...offsets[event.key]);
      else if (event.key === "+" || event.key === "=") this.zoom(1.5);
      else if (event.key === "-") this.zoom(1 / 1.5);
      else if (event.key === "Home") this.fit();
      else return;
      event.preventDefault();
    });
  }

  project([longitude, latitude]) {
    return [longitude * this.projection, -latitude];
  }

  setData(polygons, stations, linked) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const include = point => {
      const [x, y] = this.project(point);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return [x, y];
    };
    this.path = new Path2D();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const point = include(ring[i]);
          if (i === 0) this.path.moveTo(...point);
          else this.path.lineTo(...point);
        }
        this.path.closePath();
      }
    }
    this.markers = stations.map(item => {
      const button = document.createElement("button");
      const name = item.row.주유소명.trim() || "이름 없는 주유소";
      const address = item.row.소재지도로명주소 || item.row.소재지지번주소;
      button.type = "button";
      button.className = linked.has(item) ? "marker" : "marker muted";
      button.title = name + (address ? " · " + address : "");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", "false");
      button.onclick = () => {
        this.selected?.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");
        this.selected = button;
        this.selectStation(item, linked.get(item));
      };
      return { button, point: include(item.point) };
    });
    this.selected = null;
    this.layer.replaceChildren(...this.markers.map(({ button }) => button));
    this.bounds = Number.isFinite(bounds[0]) ? bounds : null;
    this.resize();
    this.fit();
  }

  resize() {
    const width = this.view.clientWidth, height = this.view.clientHeight;
    if (!width || !height) return;
    const changed = this.width !== width || this.height !== height;
    this.width = width;
    this.height = height;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    if (changed) this.fit();
    else this.draw();
  }

  fit() {
    if (this.bounds && this.width && this.height) {
      const [left, top, right, bottom] = this.bounds;
      this.baseScale = Math.min(
        Math.max(this.width - 74, 60) / Math.max(right - left, .015),
        Math.max(this.height - 74, 60) / Math.max(bottom - top, .015)
      );
      this.scale = this.baseScale;
      this.x = this.width / 2 - (left + right) / 2 * this.scale;
      this.y = this.height / 2 - (top + bottom) / 2 * this.scale;
    }
    this.draw();
  }

  zoom(factor, x = this.width / 2, y = this.height / 2) {
    if (!this.bounds || !this.scale) return;
    const next = Math.max(this.baseScale / 4, Math.min(this.baseScale * 200, this.scale * factor));
    const ratio = next / this.scale;
    this.x = x + (this.x - x) * ratio;
    this.y = y + (this.y - y) * ratio;
    this.scale = next;
    this.draw();
  }

  move(x, y) {
    if (!this.bounds) return;
    this.x += x;
    this.y += y;
    this.draw();
  }

  draw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const ctx = this.context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.bounds || !this.scale) return;
      const dpr = this.pixelRatio;
      ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, this.x * dpr, this.y * dpr);
      ctx.fillStyle = "#183b60";
      ctx.strokeStyle = "#6595bc";
      ctx.lineWidth = .85 / this.scale;
      ctx.fill(this.path, "evenodd");
      ctx.stroke(this.path);
      for (const { button, point } of this.markers) {
        const x = point[0] * this.scale + this.x;
        const y = point[1] * this.scale + this.y;
        button.hidden = x < 0 || y < 0 || x > this.width || y > this.height;
        button.style.left = x + "px";
        button.style.top = y + "px";
      }
    });
  }
}
