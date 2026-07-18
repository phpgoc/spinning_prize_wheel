<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import * as THREE from 'three';
  import type { WheelOption } from './types';
  import { createWeightedSegments } from './wheel-geometry';

  export let options: WheelOption[] = [];
  export let rotation = 0;
  export let duration = 4000;
  export let eliminatedIds: string[] = [];
  export let spinning = false;
  export let disabled = false;
  export let centerLabel = '开始';
  export let onSpin: () => void;

  let viewport: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let pitchGroup: THREE.Group;
  let spinGroup: THREE.Group;
  let frameGroup: THREE.Group;
  let particleField: THREE.Points;
  let resizeObserver: ResizeObserver;
  let frame = 0;
  let ready = false;
  let renderedRotation = rotation;
  let lastTargetRotation = rotation;
  let pitch = THREE.MathUtils.degToRad(30);
  let targetPitch = pitch;
  let dragging = false;
  let dragStartY = 0;
  let dragStartPitch = 0;
  let animation: { from: number; to: number; startedAt: number; duration: number } | null = null;

  $: optionSignature = options
    .map((option) => `${option.id}:${option.label}:${option.color}:${option.weight}:${eliminatedIds.includes(option.id)}`)
    .join('|');
  $: if (ready) {
    optionSignature;
    rebuildWheel();
  }
  $: if (ready && rotation !== lastTargetRotation) {
    animateRotation(rotation);
  }
  $: pitchDegrees = Math.round(THREE.MathUtils.radToDeg(targetPitch));

  onMount(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.05, 8.7);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    viewport.prepend(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xfff6df, 0x313625, 2.3);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
    keyLight.position.set(-3.5, 4.5, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const limeLight = new THREE.PointLight(0xe7ff72, 18, 10, 1.7);
    limeLight.position.set(3.3, -2.4, 4.2);
    scene.add(limeLight);

    pitchGroup = new THREE.Group();
    spinGroup = new THREE.Group();
    frameGroup = new THREE.Group();
    pitchGroup.add(spinGroup);
    scene.add(pitchGroup);
    scene.add(frameGroup);
    pitchGroup.rotation.x = pitch;
    spinGroup.rotation.z = -THREE.MathUtils.degToRad(renderedRotation);

    createPresentationFrame();
    createParticleField();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(viewport);
    resize();

    ready = true;
    lastTargetRotation = rotation;
    renderedRotation = rotation;
    rebuildWheel();
    renderFrame(performance.now());
  });

  onDestroy(() => {
    ready = false;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    if (spinGroup) clearGroup(spinGroup);
    if (frameGroup) clearGroup(frameGroup);
    if (particleField) {
      particleField.geometry.dispose();
      (particleField.material as THREE.Material).dispose();
    }
    renderer?.dispose();
    renderer?.forceContextLoss();
  });

  function resize() {
    if (!renderer || !camera || !viewport) return;
    const { width, height } = viewport.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width < 390 ? 9.35 : 8.7;
    camera.updateProjectionMatrix();
  }

  function renderFrame(now: number) {
    if (!ready) return;

    if (animation) {
      const progress = Math.min(1, (now - animation.startedAt) / animation.duration);
      const eased = 1 - Math.pow(1 - progress, 5);
      renderedRotation = THREE.MathUtils.lerp(animation.from, animation.to, eased);
      if (progress >= 1) animation = null;
    }

    pitch += (targetPitch - pitch) * 0.14;
    pitchGroup.rotation.x = pitch;
    spinGroup.rotation.z = -THREE.MathUtils.degToRad(renderedRotation);
    if (particleField) particleField.rotation.z += 0.00035;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(renderFrame);
  }

  function animateRotation(next: number) {
    lastTargetRotation = next;
    animation = {
      from: renderedRotation,
      to: next,
      startedAt: performance.now(),
      duration: Math.max(100, duration),
    };
  }

  function rebuildWheel() {
    if (!spinGroup) return;
    clearGroup(spinGroup);

    const eliminated = new Set(eliminatedIds);
    const depth = 0.3;

    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(2.07, 2.07, 0.46, 96),
      new THREE.MeshStandardMaterial({ color: 0x211b12, metalness: 0.82, roughness: 0.22 }),
    );
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.12;
    back.castShadow = true;
    back.receiveShadow = true;
    spinGroup.add(back);

    if (options.length === 1) {
      const option = options[0];
      const face = new THREE.Mesh(
        new THREE.CylinderGeometry(1.98, 1.98, depth, 96),
        segmentMaterial(option, eliminated.has(option.id)),
      );
      face.rotation.x = Math.PI / 2;
      face.position.z = 0.06;
      face.castShadow = true;
      spinGroup.add(face);
      addLabel(option, Math.PI / 2, eliminated.has(option.id));
    } else if (options.length > 1) {
      const weightedSegments = createWeightedSegments(options);
      options.forEach((option, index) => {
        const slice = weightedSegments[index].sizeRatio * Math.PI * 2;
        const start = Math.PI / 2 - weightedSegments[index].startRatio * Math.PI * 2;
        const end = start - slice;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(1.98 * Math.cos(start), 1.98 * Math.sin(start));
        shape.absarc(0, 0, 1.98, start, end, true);
        shape.lineTo(0, 0);

        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          steps: 1,
          curveSegments: 24,
          bevelEnabled: true,
          bevelSegments: 2,
          bevelSize: 0.012,
          bevelThickness: 0.02,
        });
        geometry.translate(0, 0, -depth / 2 + 0.06);

        const segment = new THREE.Mesh(
          geometry,
          segmentMaterial(option, eliminated.has(option.id)),
        );
        segment.castShadow = true;
        segment.receiveShadow = true;
        spinGroup.add(segment);
        addLabel(option, start - slice / 2, eliminated.has(option.id));

        const divider = new THREE.Mesh(
          new THREE.BoxGeometry(1.96, 0.025, 0.38),
          new THREE.MeshStandardMaterial({ color: 0xc89537, metalness: 0.85, roughness: 0.2 }),
        );
        divider.position.set(0.98 * Math.cos(start), 0.98 * Math.sin(start), 0.08);
        divider.rotation.z = start;
        divider.castShadow = true;
        spinGroup.add(divider);

        const peg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.075, 0.19, 14),
          new THREE.MeshPhysicalMaterial({
            color: 0xf1ce72,
            metalness: 0.78,
            roughness: 0.17,
            clearcoat: 1,
          }),
        );
        const middle = start - slice / 2;
        peg.rotation.x = Math.PI / 2;
        peg.position.set(1.88 * Math.cos(middle), 1.88 * Math.sin(middle), 0.3);
        peg.castShadow = true;
        spinGroup.add(peg);
      });
    }

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.06, 0.11, 20, 120),
      new THREE.MeshPhysicalMaterial({
        color: 0xc9963d,
        metalness: 0.82,
        roughness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
      }),
    );
    rim.position.z = 0.17;
    rim.castShadow = true;
    spinGroup.add(rim);

    const accentRim = new THREE.Mesh(
      new THREE.TorusGeometry(2.17, 0.024, 10, 120),
      new THREE.MeshBasicMaterial({ color: 0xf5d878 }),
    );
    accentRim.position.z = 0.12;
    spinGroup.add(accentRim);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.42, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0x171813,
        metalness: 0.58,
        roughness: 0.24,
        clearcoat: 1,
      }),
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.13;
    hub.castShadow = true;
    spinGroup.add(hub);

    const hubRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.53, 0.035, 12, 64),
      new THREE.MeshBasicMaterial({ color: 0xe7ff72 }),
    );
    hubRing.position.z = 0.35;
    spinGroup.add(hubRing);

    const hubCap = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0xe7ff72,
        emissive: 0x3a4712,
        emissiveIntensity: 0.55,
        metalness: 0.28,
        roughness: 0.12,
        transmission: 0.12,
        clearcoat: 1,
      }),
    );
    hubCap.position.z = 0.46;
    hubCap.rotation.z = Math.PI / 4;
    spinGroup.add(hubCap);
  }

  function createPresentationFrame() {
    const outerFrame = new THREE.Mesh(
      new THREE.TorusGeometry(2.28, 0.075, 20, 128),
      new THREE.MeshPhysicalMaterial({
        color: 0x35362d,
        metalness: 0.92,
        roughness: 0.18,
        clearcoat: 0.8,
      }),
    );
    outerFrame.position.z = -0.04;
    outerFrame.castShadow = true;
    frameGroup.add(outerFrame);

    const innerFrame = new THREE.Mesh(
      new THREE.TorusGeometry(2.19, 0.025, 12, 128),
      new THREE.MeshBasicMaterial({ color: 0xe7ff72 }),
    );
    innerFrame.position.z = 0.34;
    frameGroup.add(innerFrame);

    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      const stud = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 14, 10),
        new THREE.MeshPhysicalMaterial({
          color: index % 2 ? 0xe7ff72 : 0xf0cf73,
          emissive: index % 2 ? 0x26300b : 0x382408,
          emissiveIntensity: 0.72,
          metalness: 0.4,
          roughness: 0.2,
        }),
      );
      stud.position.set(2.28 * Math.cos(angle), 2.28 * Math.sin(angle), 0.16);
      frameGroup.add(stud);
    }

    const pointerBody = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.52, 4),
      new THREE.MeshPhysicalMaterial({
        color: 0xe7ff72,
        emissive: 0x29330c,
        emissiveIntensity: 0.7,
        metalness: 0.48,
        roughness: 0.14,
        clearcoat: 1,
      }),
    );
    pointerBody.position.set(0, 2.28, 0.52);
    pointerBody.rotation.z = Math.PI;
    pointerBody.castShadow = true;
    frameGroup.add(pointerBody);

    const pointerJewel = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshPhysicalMaterial({
        color: 0xf4d579,
        emissive: 0x4a3009,
        emissiveIntensity: 0.5,
        metalness: 0.65,
        roughness: 0.12,
        clearcoat: 1,
      }),
    );
    pointerJewel.position.set(0, 2.56, 0.52);
    frameGroup.add(pointerJewel);

    for (const side of [-1, 1]) {
      const yoke = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.5, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x5d4a2d, metalness: 0.86, roughness: 0.2 }),
      );
      yoke.position.set(side * 2.33, -0.06, -0.16);
      yoke.castShadow = true;
      frameGroup.add(yoke);

      const axle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.42, 24),
        new THREE.MeshStandardMaterial({ color: 0xd0a348, metalness: 0.88, roughness: 0.15 }),
      );
      axle.position.set(side * 2.23, 0, 0.03);
      axle.rotation.z = Math.PI / 2;
      frameGroup.add(axle);
    }

    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.72, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x3b3123, metalness: 0.78, roughness: 0.24 }),
    );
    stem.position.set(0, -2.3, -0.2);
    stem.castShadow = true;
    frameGroup.add(stem);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.82, 1.34, 0.25, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0x6a512b,
        metalness: 0.82,
        roughness: 0.2,
        clearcoat: 0.7,
      }),
    );
    pedestal.position.set(0, -2.61, -0.16);
    pedestal.castShadow = true;
    frameGroup.add(pedestal);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.48, 96),
      new THREE.MeshBasicMaterial({ color: 0x030402, transparent: true, opacity: 0.38 }),
    );
    shadow.position.set(0, -0.28, -0.5);
    shadow.scale.y = 0.9;
    frameGroup.add(shadow);
  }

  function createParticleField() {
    const points = new Float32Array(90 * 3);
    for (let index = 0; index < 90; index += 1) {
      const angle = index * 2.399963;
      const radius = 2.55 + (index % 9) * 0.11;
      points[index * 3] = Math.cos(angle) * radius;
      points[index * 3 + 1] = Math.sin(angle) * radius;
      points[index * 3 + 2] = -0.4 + (index % 7) * 0.13;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    particleField = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xe7ff72,
        size: 0.026,
        transparent: true,
        opacity: 0.62,
        sizeAttenuation: true,
      }),
    );
    scene.add(particleField);
  }

  function segmentMaterial(option: WheelOption, isEliminated: boolean) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(isEliminated ? '#4d4e47' : option.color),
      roughness: option.isRetry ? 0.52 : 0.34,
      metalness: option.isRetry ? 0.04 : 0.12,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      transparent: isEliminated,
      opacity: isEliminated ? 0.62 : 1,
      side: THREE.DoubleSide,
    });
  }

  function addLabel(option: WheelOption, angle: number, isEliminated: boolean) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `800 ${option.label.length > 8 ? 40 : 47}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(0,0,0,.12)';
    context.lineWidth = 5;
    context.fillStyle = isEliminated ? '#aaa99f' : readableText(option.color);
    const label = option.label.length > 10 ? `${option.label.slice(0, 9)}…` : option.label;
    context.strokeText(label, 256, 64, 470);
    context.fillText(label, 256, 64, 470);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(options.length > 8 ? 0.92 : 1.08, 0.27),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: isEliminated ? 0.58 : 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const labelRadius = options.length > 8 ? 1.23 : 1.3;
    plane.position.set(labelRadius * Math.cos(angle), labelRadius * Math.sin(angle), 0.245);
    plane.rotation.z = angle - Math.PI / 2;
    plane.renderOrder = 3;
    spinGroup.add(plane);
  }

  function readableText(hex: string): string {
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#171813';
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 158 ? '#171813' : '#fffdf7';
  }

  function clearGroup(group: THREE.Group) {
    while (group.children.length) {
      const child = group.children.pop()!;
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          const mapped = material as THREE.Material & { map?: THREE.Texture };
          mapped.map?.dispose();
          material.dispose();
        });
      });
    }
  }

  function clampPitch(value: number): number {
    return THREE.MathUtils.clamp(value, THREE.MathUtils.degToRad(-68), THREE.MathUtils.degToRad(68));
  }

  function beginDrag(event: PointerEvent) {
    dragging = true;
    dragStartY = event.clientY;
    dragStartPitch = targetPitch;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!dragging) return;
    targetPitch = clampPitch(dragStartPitch + (event.clientY - dragStartY) * 0.008);
  }

  function endDrag(event: PointerEvent) {
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function tiltBy(degrees: number) {
    targetPitch = clampPitch(targetPitch + THREE.MathUtils.degToRad(degrees));
  }

  function handleTiltKey(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      tiltBy(-8);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      tiltBy(8);
    } else if (event.key === 'Home') {
      event.preventDefault();
      targetPitch = 0;
    }
  }
</script>

<div class:dragging class:spinning class="three-wheel-stage">
  <div class="webgl-viewport" bind:this={viewport}></div>
  <div
    class="interaction-surface"
    role="slider"
    aria-label="3D 轮盘上下视角"
    aria-valuemin="-68"
    aria-valuemax="68"
    aria-valuenow={pitchDegrees}
    tabindex="0"
    on:pointerdown={beginDrag}
    on:pointermove={moveDrag}
    on:pointerup={endDrag}
    on:pointercancel={endDrag}
    on:keydown={handleTiltKey}
  ></div>

  <div class="orbit"><i></i><i></i><i></i></div>

  <button
    type="button"
    class="spin-button"
    aria-label={spinning ? '3D 转盘旋转中' : '开始转动 3D 转盘'}
    disabled={disabled || spinning}
    on:click={onSpin}
  >
    <strong>{spinning ? '转动中' : centerLabel}</strong>
  </button>

  <div class="tilt-controls" aria-label="3D 视角控制">
    <button type="button" aria-label="向上旋转视角" title="向上旋转" on:click={() => tiltBy(-10)}>↑</button>
    <button type="button" aria-label="恢复正面视角" title="恢复正面" on:click={() => (targetPitch = 0)}>正</button>
    <button type="button" aria-label="向下旋转视角" title="向下旋转" on:click={() => tiltBy(10)}>↓</button>
  </div>

  <div class="drag-hint"><span>↕</span> 拖动轮盘，上下旋转 3D 视角</div>
</div>

<style>
  .three-wheel-stage {
    position: relative;
    width: min(100%, 560px);
    aspect-ratio: 1;
    margin: auto;
    isolation: isolate;
    user-select: none;
  }

  .webgl-viewport {
    position: absolute;
    inset: 2%;
    overflow: hidden;
    border-radius: 50%;
    filter: drop-shadow(0 25px 28px rgba(4, 5, 3, 0.46));
  }

  .webgl-viewport :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .interaction-surface {
    position: absolute;
    inset: 8%;
    z-index: 5;
    border-radius: 50%;
    cursor: grab;
    touch-action: none;
  }

  .interaction-surface:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  .dragging .interaction-surface {
    cursor: grabbing;
  }

  .orbit {
    position: absolute;
    inset: 4%;
    z-index: -1;
    border: 1px dashed rgba(231, 255, 114, 0.12);
    border-radius: 50%;
    pointer-events: none;
  }

  .orbit i {
    position: absolute;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 11px var(--accent);
  }

  .orbit i:nth-child(1) { top: 12%; left: 18%; }
  .orbit i:nth-child(2) { right: 2%; bottom: 29%; }
  .orbit i:nth-child(3) { bottom: 4%; left: 31%; }

  .spinning .orbit {
    animation: orbit-spin 7s linear infinite;
  }

  @keyframes orbit-spin {
    to { transform: rotate(360deg); }
  }

  .spin-button {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 10;
    display: flex;
    width: 15%;
    min-width: 76px;
    aspect-ratio: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 0;
    border: 1px solid rgba(231, 255, 114, 0.7);
    border-radius: 50%;
    background: #171813;
    color: #fffdf7;
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35), inset 0 0 18px rgba(231, 255, 114, 0.06);
    transform: translate(-50%, -50%);
    transition: transform 180ms ease, background 180ms ease;
  }

  .spin-button:hover:not(:disabled),
  .spin-button:focus-visible {
    background: #27291f;
    transform: translate(-50%, -50%) scale(1.06);
  }

  .spin-button strong {
    margin-top: 0;
    font-size: clamp(
      calc(15px * var(--font-scale, 1)),
      calc(1.25vw * var(--font-scale, 1)),
      calc(20px * var(--font-scale, 1))
    );
  }

  .tilt-controls {
    position: absolute;
    top: 50%;
    right: 1.5%;
    z-index: 11;
    display: flex;
    flex-direction: column;
    padding: 3px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 999px;
    background: rgba(11, 12, 9, 0.68);
    backdrop-filter: blur(10px);
    transform: translateY(-50%);
  }

  .tilt-controls button {
    display: grid;
    width: 27px;
    height: 27px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #a8aa9e;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: calc(12px * var(--font-scale, 1));
    place-items: center;
  }

  .tilt-controls button:hover,
  .tilt-controls button:focus-visible {
    background: rgba(231, 255, 114, 0.12);
    color: var(--accent);
  }

  .drag-hint {
    position: absolute;
    bottom: 1.5%;
    left: 50%;
    z-index: 11;
    padding: 6px 9px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 999px;
    background: rgba(11, 12, 9, 0.52);
    color: #85887b;
    font-family: var(--font-mono);
    font-size: calc(10px * var(--font-scale, 1));
    pointer-events: none;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .drag-hint span {
    margin-right: 4px;
    color: var(--accent);
  }

  @media (max-width: 600px) {
    .three-wheel-stage { width: min(100%, 440px); }
    .webgl-viewport { inset: 0; }
    .spin-button { min-width: 64px; }
    .tilt-controls { right: 0; }
    .drag-hint { bottom: -1%; }
  }
</style>
