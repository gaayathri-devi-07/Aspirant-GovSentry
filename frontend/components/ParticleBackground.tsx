"use client";

import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

function ParticleCloud() {
  const ref = useRef<THREE.Points>(null);
  const particles = useMemo(() => {
    const count = 850;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 4 + Math.random() * 5.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
    }
    return positions;
  }, []);

  useFrame((state, delta) => {
    if (!ref.current) {
      return;
    }
    ref.current.rotation.x += delta * 0.04;
    ref.current.rotation.y += delta * 0.06;
    ref.current.rotation.z += delta * 0.015;
    const elapsed = state.clock.getElapsedTime();
    ref.current.position.y = Math.sin(elapsed * 0.22) * 0.15;
  });

  return (
    <Points ref={ref} positions={particles} stride={3} frustumCulled>
      <PointMaterial
        transparent
        color="#5eead4"
        size={0.025}
        sizeAttenuation
        depthWrite={false}
        opacity={0.45}
      />
    </Points>
  );
}

export default function ParticleBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <Canvas camera={{ position: [0, 0, 9], fov: 50 }} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.8} />
        <fog attach="fog" args={["#050b18", 8, 18]} />
        <ParticleCloud />
      </Canvas>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,5,13,0.2)_56%,rgba(2,5,13,0.72)_100%)]" />
    </div>
  );
}
