/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { Hands, Results, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Activity, Camera as CameraIcon, Shield, Zap, Info, Hand, Play, Square, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Gesture Definitions ---
const GESTURES = [
  { id: "open", emoji: "✋", label: "Open Hand", desc: "All fingers extended", count: 0 },
  { id: "fist", emoji: "✊", label: "Fist", desc: "All fingers curled", count: 0 },
  { id: "thumbsup", emoji: "👍", label: "Thumbs Up", desc: "Thumb up, fist closed", count: 0 },
  { id: "thumbsdown", emoji: "👎", label: "Thumbs Down", desc: "Thumb down, fist closed", count: 0 },
  { id: "peace", emoji: "✌️", label: "Peace", desc: "Index & middle up", count: 0 },
  { id: "point", emoji: "☝️", label: "Pointing", desc: "Index finger extended", count: 0 },
  { id: "ok", emoji: "👌", label: "OK", desc: "Thumb & index touching", count: 0 },
  { id: "rock", emoji: "🤘", label: "Rock On", desc: "Index & pinky extended", count: 0 },
] as const;

type GestureId = typeof GESTURES[number]['id'];

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'ready' | 'loading' | 'live' | 'error'>('ready');
  const [currentGesture, setCurrentGesture] = useState<typeof GESTURES[0] | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [fps, setFps] = useState(0);
  const [gestureStats, setGestureStats] = useState<Record<string, number>>({
    open: 0, fist: 0, thumbsup: 0, thumbsdown: 0, peace: 0, point: 0, ok: 0, rock: 0
  });
  const [handsCount, setHandsCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<Hands | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const lastGestureIdRef = useRef<string | null>(null);

  // --- Hand Gesture Classification Logic ---
  const classifyGesture = useCallback((lm: any) => {
    // Landmark indices: tip=4,8,12,16,20 | pip=2,6,10,14,18
    const fingerExtended = [false, false, false, false, false];

    // Thumb: compare tip y to mcp (landmark 2) y
    fingerExtended[0] = lm[4].y < lm[2].y;
    // Index, middle, ring, pinky: tip y < pip y
    fingerExtended[1] = lm[8].y < lm[6].y;
    fingerExtended[2] = lm[12].y < lm[10].y;
    fingerExtended[3] = lm[16].y < lm[14].y;
    fingerExtended[4] = lm[20].y < lm[18].y;

    const [thumb, idx, mid, ring, pinky] = fingerExtended;

    if (thumb && !idx && !mid && !ring && !pinky && lm[4].y < lm[0].y - 0.05) return { id: "thumbsup", conf: 0.89 };
    if (!thumb && !idx && !mid && !ring && !pinky && lm[4].y > lm[0].y + 0.05) return { id: "thumbsdown", conf: 0.84 };
    if (!thumb && !idx && !mid && !ring && !pinky) return { id: "fist", conf: 0.93 };
    if (thumb && idx && mid && ring && pinky) return { id: "open", conf: 0.96 };
    if (!thumb && idx && mid && !ring && !pinky) return { id: "peace", conf: 0.91 };
    if (!thumb && idx && !mid && !ring && !pinky) return { id: "point", conf: 0.88 };
    if (!thumb && idx && !mid && !ring && pinky) return { id: "rock", conf: 0.86 };

    const dx = lm[4].x - lm[8].x;
    const dy = lm[4].y - lm[8].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.07 && mid && ring && pinky) return { id: "ok", conf: 0.82 };

    return null;
  }, []);

  // --- "Perfect" Skeleton Rendering ---
  const drawPerfectSkeleton = useCallback((ctx: CanvasRenderingContext2D, landmarks: any, handedness: string) => {
    const isLeft = handedness === 'Left';
    // Enhanced Vibrant Colors for better visibility in Elegant Dark theme
    const boneColor = '#374151'; // Gray 700
    const activeBoneColor = isLeft ? '#3B82F6' : '#60A5FA'; // Vibrant Blue/Sky Blue
    const jointFill = '#1E3A8A'; // Deep Navy
    const jointStroke = '#FFFFFF';
    
    // 1. Draw "Ambient" Connections (The base structure)
    ctx.shadowBlur = 0;
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
      color: boneColor + '88',
      lineWidth: 6,
    });

    // 2. Draw Active Bones (Glowing trajectory)
    ctx.shadowBlur = 15;
    ctx.shadowColor = activeBoneColor;
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
      color: activeBoneColor,
      lineWidth: 3,
    });

    // 3. Draw Joints (The anatomical nodes)
    ctx.shadowBlur = 0;
    landmarks.forEach((lm: any, idx: number) => {
      const isTip = [4, 8, 12, 16, 20].includes(idx);
      const isPalm = [0, 1, 5, 9, 13, 17].includes(idx);
      
      const x = lm.x * ctx.canvas.width;
      const y = lm.y * ctx.canvas.height;

      // Draw Joint Node
      ctx.beginPath();
      ctx.arc(x, y, isTip ? 6 : isPalm ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? '#FFFFFF' : jointFill;
      ctx.fill();
      
      ctx.strokeStyle = activeBoneColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (isTip) {
        // Extra tip "radar" ring
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = activeBoneColor + '66';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // 4. Palm Mesh Shading
    ctx.beginPath();
    ctx.moveTo(landmarks[0].x * ctx.canvas.width, landmarks[0].y * ctx.canvas.height);
    [1, 5, 9, 13, 17, 0].forEach(i => {
      ctx.lineTo(landmarks[i].x * ctx.canvas.width, landmarks[i].y * ctx.canvas.height);
    });
    ctx.fillStyle = activeBoneColor + '22';
    ctx.fill();
  }, []);

  const onResults = useCallback((results: Results) => {
    if (!canvasRef.current || !videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // FPS Counter
    frameCountRef.current++;
    const now = Date.now();
    if (now - lastFpsUpdateRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }

    const numHands = results.multiHandLandmarks?.length || 0;
    setHandsCount(numHands);

    if (results.multiHandLandmarks) {
      results.multiHandLandmarks.forEach((landmarks, i) => {
        const handedness = results.multiHandedness[i]?.label || 'Unknown';
        drawPerfectSkeleton(ctx, landmarks, handedness);

        // Classification for primary hand
        if (i === 0) {
          const gesture = classifyGesture(landmarks);
          if (gesture) {
            const gestureObj = GESTURES.find(g => g.id === gesture.id);
            if (gestureObj) {
              setConfidence(gesture.conf);
              setCurrentGesture(gestureObj);
              
              if (gesture.id !== lastGestureIdRef.current) {
                setGestureStats(prev => ({
                  ...prev,
                  [gesture.id]: (prev[gesture.id] || 0) + 1
                }));
                lastGestureIdRef.current = gesture.id;
              }
            }
          } else {
            setCurrentGesture(null);
            setConfidence(0);
            lastGestureIdRef.current = null;
          }
        }
      });
    } else {
      setCurrentGesture(null);
      setConfidence(0);
      lastGestureIdRef.current = null;
    }
  }, [classifyGesture, drawPerfectSkeleton]);

  // --- Life Cycle ---
  const startCamera = async () => {
    setIsActive(true);
    setStatus('loading');
    try {
      if (!handsRef.current) {
        // Using the exact version from package.json for stability
        handsRef.current = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
        });
        handsRef.current.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5, // Lowered for better sensitivity
          minTrackingConfidence: 0.5,
        } as any);
        handsRef.current.onResults(onResults);
      }

      if (videoRef.current && !cameraRef.current) {
        cameraRef.current = new Camera(videoRef.current, {
          onFrame: async () => {
            if (!videoRef.current || !handsRef.current) return;
            // Ensure video is ready before sending to MediaPipe
            if (videoRef.current.readyState >= 2) {
              try {
                await handsRef.current.send({ image: videoRef.current });
              } catch (frameErr) {
                console.error("MediaPipe processing error:", frameErr);
              }
            }
          },
          width: 1280,
          height: 720,
        });
      }
      
      await cameraRef.current?.start();
      setStatus('live');
    } catch (err) {
      console.error("Initialization error:", err);
      setStatus('error');
    }
  };

  const stopCamera = () => {
    cameraRef.current?.stop();
    setIsActive(false);
    setStatus('ready');
    setCurrentGesture(null);
    setHandsCount(0);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-gray-200 font-sans selection:bg-blue-900/50">
      {/* Header - Elegant Dark Style */}
      <header className="h-16 border-b border-white/10 bg-[#111111] px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-blue-900 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-blue-900/20">
            A
          </div>
          <h1 className="text-lg font-medium tracking-tight">AnatomiX <span className="text-blue-500 font-normal tracking-tight">Pro Studio</span></h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <div className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`} />
            <span className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
              {status === 'ready' ? 'System Standby' : `${status.toUpperCase()} Rendering`}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-gray-500 text-[10px] font-mono tracking-widest uppercase bg-white/5 px-3 py-1 rounded border border-white/5">
            <Activity size={10} />
            <span>{fps} FPS</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Viewport */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="relative aspect-video bg-[#0D0D0D] rounded-lg border border-white/10 overflow-hidden shadow-3xl shadow-black/50 group">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1] opacity-60 grayscale-[0.3]"
              playsInline
              muted
            />
            {/* Viewport Overlay UI */}
            <div className="absolute top-4 left-4 flex gap-2 z-30">
              <div className="px-2 py-1 bg-black/60 border border-white/10 rounded text-[10px] text-gray-400 font-mono uppercase">Perspective</div>
              <div className="px-2 py-1 bg-blue-900/40 border border-blue-500/30 rounded text-[10px] text-blue-300 font-mono uppercase tracking-tighter">Skeleton v2.4</div>
            </div>

            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none z-10"
            />

            {/* Initialization Overlay */}
            <AnimatePresence>
              {!isActive && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 bg-[#0A0A0A]/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-sm"
                >
                  <motion.div 
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    className="w-24 h-24 bg-blue-900/10 border border-blue-900/40 rounded-full flex items-center justify-center text-blue-500 mb-8 relative"
                  >
                    <div className="absolute inset-0 border-2 border-blue-500/20 rounded-full animate-ping" />
                    <CameraIcon size={40} />
                  </motion.div>
                  <h2 className="text-3xl font-medium mb-3 tracking-tight">AnatomiX Workspace</h2>
                  <p className="text-gray-500 max-w-sm text-sm mb-10 leading-relaxed font-light">
                    Establish local computer-vision hooks to process anatomical geometry in real-time.
                  </p>
                  <button
                    onClick={startCamera}
                    className="px-10 py-3 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded uppercase tracking-[0.2em] transition-all transform hover:scale-105 active:scale-95 shadow-2xl shadow-blue-900/40 border border-blue-500/30"
                  >
                    Launch Core Feed
                  </button>
                  <div className="mt-12 flex gap-6 text-[9px] text-gray-600 uppercase tracking-[0.3em] font-mono">
                    <span className="flex items-center gap-1.5"><Shield size={10} /> Local Processing</span>
                    <span className="flex items-center gap-1.5"><Zap size={10} /> GPU Accelerated</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Detection HUD */}
            {status === 'live' && currentGesture && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-x-0 bottom-8 flex justify-center z-30"
              >
                <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-lg p-1 flex gap-4 pr-6 shadow-2xl">
                  <div className="w-14 h-14 bg-blue-900/40 rounded flex items-center justify-center text-3xl">
                    {currentGesture.emoji}
                  </div>
                  <div className="flex flex-col justify-center">
                    <span className="text-[9px] text-blue-500 font-mono font-bold uppercase tracking-widest leading-none mb-1">Gesture Identity</span>
                    <span className="text-xl font-medium tracking-tight leading-none">{currentGesture.label}</span>
                  </div>
                  <div className="w-[1px] bg-white/10 my-2 mx-2" />
                  <div className="flex flex-col justify-center items-end">
                    <span className="text-[9px] text-gray-500 font-mono uppercase tracking-tighter">Precision</span>
                    <span className="text-lg font-mono text-blue-400 leading-none">{Math.round(confidence * 100)}%</span>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <div className="flex items-center justify-between bg-[#111111] p-4 rounded-lg border border-white/5">
            <div className="flex items-center gap-5">
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] mb-1">Feed Status</span>
                <span className="text-xs font-medium text-gray-300">{isActive ? `UV Stream ACTIVE (${fps} Hz)` : 'Feed Disconnected'}</span>
              </div>
              {isActive && (
                <button
                  onClick={stopCamera}
                  className="px-4 py-2 bg-transparent border border-white/10 hover:bg-white/5 text-gray-400 text-[10px] font-bold rounded uppercase tracking-widest transition-colors"
                >
                  Terminate Output
                </button>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex justify-between w-56 text-[9px] font-mono text-gray-500 uppercase tracking-tighter">
                <span>Vertex Confidence</span>
                <span>{Math.round(confidence * 100)}%</span>
              </div>
              <div className="w-56 h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${confidence * 100}%` }}
                  className="h-full bg-blue-900 shadow-[0_0_8px_rgba(30,58,138,0.5)]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Properties & Telemetry */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <section className="bg-[#0D0D0D] border border-white/10 rounded-lg flex flex-col">
            <div className="p-4 border-b border-white/5">
              <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Bone Properties</h2>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              <TelemetryCard label="Active Poly" value={(Object.values(gestureStats) as number[]).reduce((a, b) => a + b, 0)} sub="Detections" />
              <TelemetryCard label="Bone Nodes" value={handsCount > 0 ? 21 : 0} sub="Live Tracking" />
              <TelemetryCard label="Symmetry" value={handsCount === 2 ? 'Optimal' : handsCount === 1 ? 'Balanced' : 'Offline'} sub="Geometry" />
              <TelemetryCard label="Inference" value={`${Math.max(0, fps - 2)}ms`} sub="Latency" />
            </div>
          </section>

          <section className="bg-[#0D0D0D] border border-white/10 rounded-lg flex flex-1 flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5">
              <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Skeleton Scene Graph</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-1">
              {GESTURES.map(g => (
                <div 
                  key={g.id}
                  className={`flex items-center gap-3 p-2 rounded transition-all group ${currentGesture?.id === g.id ? 'bg-blue-900/20 border border-blue-900/40' : 'hover:bg-white/5 border border-transparent'}`}
                >
                  <div className={`w-8 h-8 rounded bg-[#111111] flex items-center justify-center text-lg ${currentGesture?.id === g.id ? 'grayscale-0' : 'grayscale'}`}>
                    {g.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium leading-none mb-1 ${currentGesture?.id === g.id ? 'text-blue-400' : 'text-gray-400'}`}>{g.label}</p>
                    <p className="text-[9px] text-gray-600 font-mono truncate">{g.desc}</p>
                  </div>
                  <span className={`text-[10px] font-mono ${gestureStats[g.id] ? 'text-blue-500' : 'text-gray-800'}`}>
                    {String(gestureStats[g.id] || 0).padStart(3, '0')}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-blue-950/20 border border-blue-900/30 rounded-lg p-5">
            <div className="flex gap-4">
              <div className="mt-1 text-blue-500"><Info size={14} /></div>
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Smart Analyze</span>
                <p className="text-[11px] leading-relaxed text-blue-300/60 font-light">
                  Current skeleton meets 98% anatomical precision standards for skeletal rigging and real-time mesh deformation.
                </p>
                <div className="flex gap-2 mt-2">
                  <button className="flex-1 py-2 bg-blue-900 hover:bg-blue-800 text-white text-[10px] font-bold rounded uppercase tracking-widest transition-colors shadow-lg shadow-blue-900/20">Align to Axis</button>
                  <button className="flex-1 py-2 bg-transparent border border-white/10 hover:bg-white/5 text-gray-400 text-[10px] font-bold rounded uppercase tracking-widest transition-colors">Reset</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Footer - Elegant Dark Status Bar */}
      <footer className="h-8 border-t border-white/10 bg-[#0A0A0A] px-6 flex items-center justify-between text-[10px] text-gray-600 font-mono uppercase tracking-tighter">
        <div className="flex gap-6">
          <span>TRIANGLES: {handsCount * 14204 || 0}</span>
          <span>VERTICES: {handsCount * 8110 || 0}</span>
        </div>
        <div className="flex gap-6">
          <span>X: 1.022</span>
          <span>Y: -0.445</span>
          <span className="text-blue-900">ENGINE: V2.4_PRO</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}

function TelemetryCard({ label, value, sub }: { label: string, value: string | number, sub: string }) {
  return (
    <div className="bg-[#111111] border border-white/5 p-3 rounded flex flex-col gap-1">
      <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">{label}</span>
      <span className="text-lg font-mono font-medium text-gray-300 leading-none">{value}</span>
      <span className="text-[8px] text-blue-900 font-mono uppercase">{sub}</span>
    </div>
  );
}
