import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function initLandingAnimations() {
  gsap.registerPlugin(ScrollTrigger);
  const root = document.querySelector("main");
  if (!root) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mm = gsap.matchMedia();
  const context = gsap.context(() => {
    const heroLayers = gsap.utils.toArray<HTMLElement>("[data-hero-stack] .layer");
    if (!reduceMotion.matches && heroLayers.length) {
      gsap.to(heroLayers, { y: -3, duration: 2.8, ease: "sine.inOut", stagger: .12, repeat: -1, yoyo: true });
      gsap.to(".pulse-line", { scaleX: .72, duration: 1.8, ease: "sine.inOut", repeat: -1, yoyo: true });
    }

    mm.add({ reduce: "(prefers-reduced-motion: reduce)", desktop: "(min-width: 801px)" }, (ctx) => {
      const { reduce, desktop } = ctx.conditions as { reduce: boolean; desktop: boolean };
      const request = document.querySelector<HTMLElement>('[data-scene="request"]');
      if (request) {
        const steps = gsap.utils.toArray<HTMLElement>(".lifecycle-step", request);
        const ring = request.querySelector<HTMLElement>(".scope-ring-request");
        const setStep = (index: number) => steps.forEach((step, stepIndex) => {
          step.classList.toggle("is-active", stepIndex === index);
          step.classList.toggle("is-complete", stepIndex < index);
        });
        const timeline = gsap.timeline({ paused: true });
        steps.forEach((step, index) => {
          const start = index * .7;
          timeline.call(() => setStep(index), [], start);
          timeline.to(step, { color: "#e8eaef", borderColor: "#d4a017", duration: .2 }, start);
          if (index > 0) timeline.to(steps[index - 1], { color: "rgba(232,234,239,.36)", borderColor: "transparent", duration: .2 }, start + .22);
        });
        timeline.to(ring, { scale: 1.08, duration: .25, ease: "power2.out" }, 0)
          .to(ring, { scale: 1, duration: .25, ease: "power2.in" }, .25);
        if (reduce) {
          gsap.set(steps, { clearProps: "all" });
          gsap.set(ring, { clearProps: "all" });
          steps.forEach((step) => step.classList.add("is-active"));
        } else if (desktop) {
          ScrollTrigger.create({ trigger: request, start: "top top", end: "+=115%", pin: true, scrub: .8, animation: timeline, invalidateOnRefresh: true });
        } else {
          ScrollTrigger.create({ trigger: request, start: "top 75%", end: "bottom 55%", scrub: .5, animation: timeline });
        }
      }

      const pod = document.querySelector<HTMLElement>('[data-scene="pod"]');
      if (pod) {
        const draw = pod.querySelector<HTMLElement>("[data-draw-line]");
        const labels = gsap.utils.toArray<HTMLElement>(".edge-label", pod);
        const panel = pod.querySelector<HTMLElement>(".pod-shell");
        if (reduce) { gsap.set([draw, ...labels, panel].filter(Boolean), { clearProps: "all" }); }
        else {
          gsap.from(draw, { clipPath: "inset(0 100% 0 0)", duration: .8, ease: "power2.out", scrollTrigger: { trigger: pod, start: "top 70%" } });
          gsap.from(labels, { opacity: 0, y: 8, duration: .35, stagger: .06, ease: "power2.out", scrollTrigger: { trigger: pod, start: "top 65%" } });
          gsap.from(panel, { scale: .92, opacity: 0, duration: .7, ease: "power3.out", scrollTrigger: { trigger: pod, start: "top 65%" } });
        }
      }

      const di = document.querySelector<HTMLElement>('[data-scene="di"]');
      if (di) {
        const tuple = di.querySelector<HTMLElement>('[data-di-token="tuple"]');
        const param = di.querySelector<HTMLElement>('[data-di-token="param"]');
        const sequence = gsap.timeline({ scrollTrigger: reduce ? undefined : { trigger: di, start: "top 68%" } });
        if (reduce) { tuple?.classList.add("is-highlighted"); param?.classList.add("is-highlighted"); }
        else sequence.to(tuple, { onStart: () => tuple?.classList.add("is-highlighted"), duration: .3 }).to(param, { onStart: () => param?.classList.add("is-highlighted"), duration: .3 }, "+=.35");
      }

      const native = document.querySelector<HTMLElement>('[data-scene="native"]');
      if (native && !reduce) {
        gsap.from(native.querySelectorAll(".native-wrapper"), { opacity: 0, scaleX: .7, duration: .7, stagger: .18, ease: "power3.out", scrollTrigger: { trigger: native, start: "top 68%" } });
        gsap.from(native.querySelector(".native-band"), { opacity: 0, duration: .6, delay: .2, scrollTrigger: { trigger: native, start: "top 68%" } });
      }

      const checklist = document.querySelector<HTMLElement>('[data-scene="checklist"]');
      if (checklist) {
        const commands = gsap.utils.toArray<HTMLElement>(".terminal-command", checklist);
        if (reduce) gsap.set(commands, { clearProps: "all" });
        else gsap.from(commands, { opacity: 0, x: -16, duration: .35, stagger: .12, ease: "power2.out", scrollTrigger: { trigger: checklist, start: "top 68%" } });
      }
    });
    return () => mm.revert();
  }, root);

  const cleanup = () => { mm.revert(); context.revert(); };
  window.addEventListener("pagehide", cleanup, { once: true });
  reduceMotion.addEventListener?.("change", () => { context.revert(); initLandingAnimations(); }, { once: true });
}
