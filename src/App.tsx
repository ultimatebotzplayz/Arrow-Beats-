import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Trophy, Music, Settings, Keyboard, TrendingUp, ArrowLeft, ArrowDown, ArrowUp, ArrowRight, List, X, Medal, User, LogOut, LogIn, Bug } from 'lucide-react';

import YouTube, { YouTubeProps } from 'react-youtube';

// --- Constants ---
const LANE_KEYS = ['d', 'f', 'j', 'k'] as const;
const LANE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981']; // Red, Yellow, Blue, Green
const LANE_ICONS = [ArrowLeft, ArrowDown, ArrowUp, ArrowRight];
const NOTE_SPEED = 0.6; // pixels per ms
const HIT_WINDOW_PERFECT = 45;
const HIT_WINDOW_GREAT = 90;
const HIT_WINDOW_GOOD = 135;
const HIT_WINDOW_OKAY = 180;
const SPAWN_Y = -50;
const HIT_LINE_Y = 500;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const LANE_WIDTH = CANVAS_WIDTH / 4;

type LaneKey = typeof LANE_KEYS[number];

interface Note {
  id: number;
  lane: number;
  timestamp: number; // when it should be hit
  hit: boolean;
  missed: boolean;
}

interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  okay: number;
  miss: number;
}

interface LeaderboardEntry {
  id?: number;
  user_id?: number;
  username: string;
  score: number;
  max_combo: number;
  date: string;
  song: string;
  difficulty: string;
}

interface UserData {
  id: number;
  username: string;
  xp: number;
  level: number;
  email?: string;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  duration: number;
  youtubeId: string;
}

interface Difficulty {
  name: string;
  color: string;
  multiplier: number;
}

const SONGS: Song[] = [
  { id: 'critical-hit', title: 'Critical Hit', artist: 'MDK', bpm: 128, duration: 155000, youtubeId: 'rQZinpJoiYQ' },
  { id: 'press-start', title: 'Press Start', artist: 'MDK', bpm: 140, duration: 180000, youtubeId: 'XoLouT7TqZY' },
  { id: 'freedom-dive', title: 'FREEDOM DiVE', artist: 'xi', bpm: 222.22, duration: 257000, youtubeId: 'k-3y2LVF_SE' },
];

const DIFFICULTIES: Difficulty[] = [
  { name: 'EASY', color: '#22c55e', multiplier: 0.6 },
  { name: 'MEDIUM', color: '#eab308', multiplier: 1.0 },
  { name: 'HARD', color: '#ef4444', multiplier: 1.5 },
  { name: 'EXPERT', color: '#ec4899', multiplier: 1.8 },
  { name: 'MASTER', color: '#a855f7', multiplier: 2.0 },
];

const INITIAL_SCORE: ScoreState = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  great: 0,
  good: 0,
  okay: 0,
  miss: 0,
};

const ADMIN_USERNAME = 'ultimatebotzRBX';

// --- Mock Song Data ---
const generateMockSong = (durationMs: number, multiplier: number): Note[] => {
  const notes: Note[] = [];
  let id = 0;
  const baseInterval = 800 / multiplier;
  for (let t = 1000; t < durationMs; t += (baseInterval * 0.5) + Math.random() * baseInterval) {
    const lane = Math.floor(Math.random() * 4);
    notes.push({ id: id++, lane, timestamp: t, hit: false, missed: false });
  }
  return notes;
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'results'>('menu');
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState<ScoreState>(INITIAL_SCORE);
  const [lastJudgement, setLastJudgement] = useState<string | null>(null);
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  
  const [user, setUser] = useState<UserData | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '', email: '' });
  const [authError, setAuthError] = useState('');
  
  const [selectedSong, setSelectedSong] = useState<Song>(SONGS[0]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(DIFFICULTIES[1]);
  
  const [shake, setShake] = useState(0);
  const [isMusicReady, setIsMusicReady] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<any>(null);
  const menuPlayerRef = useRef<any>(null);

  const pauseStartTimeRef = useRef<number>(0);
  const totalPauseDurationRef = useRef<number>(0);

  const playTone = (freq: number, type: OscillatorType = 'sine', duration = 0.1) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const playClick = () => playTone(440, 'sine', 0.05);
  const playHit = (lane: number) => {
    const freqs = [261.63, 293.66, 329.63, 349.23]; // C4, D4, E4, F4
    playTone(freqs[lane], 'triangle', 0.1);
  };
  const playMiss = () => playTone(110, 'sawtooth', 0.2);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const startTimeRef = useRef<number>(0);
  const notesRef = useRef<Note[]>([]);
  const hitEffectsRef = useRef<{ lane: number; time: number; color: string }[]>([]);
  const visualizerRef = useRef<number[]>(new Array(32).fill(0));

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      setLeaderboard(data);
    } catch (e) {
      console.error("Failed to fetch leaderboard", e);
    }
  };

  // Load leaderboard on mount
  useEffect(() => {
    fetchLeaderboard();
    
    // Check for saved user
    const savedUser = localStorage.getItem('arrow_beats_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }

    // Initial loading delay
    const timer = setTimeout(() => setIsLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  const saveToLeaderboard = async (finalScore: number, finalMaxCombo: number) => {
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id,
          username: user?.username || 'Guest',
          score: finalScore,
          maxCombo: finalMaxCombo,
          song: selectedSong.title,
          difficulty: selectedDifficulty.name
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        localStorage.setItem('arrow_beats_user', JSON.stringify(data.user));
      }
      fetchLeaderboard();
    } catch (e) {
      console.error("Failed to save score", e);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    if (authMode === 'forgot') {
      try {
        const res = await fetch('/api/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: authForm.username, newPassword: authForm.password })
        });
        const data = await res.json();
        if (data.success) {
          setAuthMode('login');
          setAuthError('Password reset! Please login.');
        } else {
          setAuthError(data.error);
        }
      } catch (e) {
        setAuthError('Connection failed');
      }
      return;
    }

    const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        localStorage.setItem('arrow_beats_user', JSON.stringify(data.user));
        setShowAuthModal(false);
        setAuthForm({ username: '', password: '', email: '' });
      } else {
        setAuthError(data.error);
      }
    } catch (e) {
      setAuthError('Connection failed');
    }
  };

  const handleSocialAuth = async (provider: 'facebook' | 'google') => {
    setAuthError('');
    // Mock social login
    const providerId = Math.random().toString(36).substring(7);
    const mockUsername = `${provider}_user_${providerId}`;
    const mockEmail = `${mockUsername}@example.com`;
    
    try {
      const res = await fetch('/api/auth/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, providerId, username: mockUsername, email: mockEmail })
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        localStorage.setItem('arrow_beats_user', JSON.stringify(data.user));
        setShowAuthModal(false);
      } else {
        setAuthError(data.error);
      }
    } catch (e) {
      setAuthError('Social login failed');
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('arrow_beats_user');
  };

  const startGame = () => {
    if (!isMusicReady) return;
    playClick();
    setScore(INITIAL_SCORE);
    setLastJudgement(null);
    setShake(0);
    setIsPaused(false);
    totalPauseDurationRef.current = 0;
    notesRef.current = generateMockSong(selectedSong.duration, selectedDifficulty.multiplier);
    
    // Start YouTube player
    if (playerRef.current) {
      playerRef.current.seekTo(0);
      playerRef.current.playVideo();
    }
    
    // Stop menu music
    if (menuPlayerRef.current) {
      menuPlayerRef.current.pauseVideo();
    }
    
    startTimeRef.current = performance.now();
    setGameState('playing');
    
    // Ensure first frame is drawn
    setTimeout(() => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(update);
    }, 50);
  };

  const togglePause = () => {
    if (gameState !== 'playing') return;
    
    if (isPaused) {
      // Resume
      const pauseDuration = performance.now() - pauseStartTimeRef.current;
      totalPauseDurationRef.current += pauseDuration;
      setIsPaused(false);
      if (playerRef.current) playerRef.current.playVideo();
      requestRef.current = requestAnimationFrame(update);
    } else {
      // Pause
      pauseStartTimeRef.current = performance.now();
      setIsPaused(true);
      if (playerRef.current) playerRef.current.pauseVideo();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  };

  const quitGame = () => {
    setGameState('menu');
    setIsPaused(false);
    if (playerRef.current) playerRef.current.stopVideo();
    if (menuPlayerRef.current) menuPlayerRef.current.playVideo();
  };

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    playerRef.current = event.target;
    setIsMusicReady(true);
  };

  const onMenuPlayerReady: YouTubeProps['onReady'] = (event) => {
    menuPlayerRef.current = event.target;
    event.target.setVolume(30);
    event.target.playVideo();
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    // If video starts playing (state 1)
    if (event.data === 1 && gameState === 'playing') {
      startTimeRef.current = performance.now();
    }
    // If video ends, end game
    if (event.data === 0) {
      setGameState('results');
      saveToLeaderboard(score.score, score.maxCombo);
    }
  };

  const handleHit = useCallback((laneIndex: number) => {
    if (isPaused) return;
    const currentTime = performance.now() - startTimeRef.current - totalPauseDurationRef.current;
    const laneNotes = notesRef.current.filter(n => n.lane === laneIndex && !n.hit && !n.missed);
    
    if (laneNotes.length === 0) {
      // User clicked but no note was there - count as a miss or just show feedback
      setLastJudgement('MISS');
      setScore(s => ({ ...s, combo: 0, miss: s.miss + 1 }));
      setShake(5);
      hitEffectsRef.current.push({ lane: laneIndex, time: performance.now(), color: '#f43f5e' });
      playMiss();
      return;
    }

    const closestNote = laneNotes.reduce((prev, curr) => 
      Math.abs(curr.timestamp - currentTime) < Math.abs(prev.timestamp - currentTime) ? curr : prev
    );

    const diff = currentTime - closestNote.timestamp;
    const absDiff = Math.abs(diff);

    if (absDiff <= HIT_WINDOW_OKAY) {
      closestNote.hit = true;
      
      let points = 0;
      let judgement = '';
      let color = '#ffffff';
      const isLate = diff > 20; // Small buffer for "Perfect"
      const isEarly = diff < -20;
      
      if (absDiff <= HIT_WINDOW_PERFECT) {
        points = 300;
        judgement = 'PERFECT';
        color = '#FFD700';
        setScore(s => ({ ...s, perfect: s.perfect + 1, score: s.score + points, combo: s.combo + 1, maxCombo: Math.max(s.maxCombo, s.combo + 1) }));
      } else if (absDiff <= HIT_WINDOW_GREAT) {
        points = 200;
        judgement = isLate ? 'LATE GREAT' : isEarly ? 'EARLY GREAT' : 'GREAT';
        color = '#34d399';
        setScore(s => ({ ...s, great: s.great + 1, score: s.score + points, combo: s.combo + 1, maxCombo: Math.max(s.maxCombo, s.combo + 1) }));
      } else if (absDiff <= HIT_WINDOW_GOOD) {
        points = 100;
        judgement = isLate ? 'LATE GOOD' : isEarly ? 'EARLY GOOD' : 'GOOD';
        color = '#3b82f6';
        setScore(s => ({ ...s, good: s.good + 1, score: s.score + points, combo: s.combo + 1, maxCombo: Math.max(s.maxCombo, s.combo + 1) }));
      } else {
        points = 50;
        judgement = isLate ? 'LATE OKAY' : isEarly ? 'EARLY OKAY' : 'OKAY';
        color = '#fbbf24';
        setScore(s => ({ ...s, okay: s.okay + 1, score: s.score + points, combo: s.combo + 1, maxCombo: Math.max(s.maxCombo, s.combo + 1) }));
      }
      
      hitEffectsRef.current.push({ lane: laneIndex, time: performance.now(), color });
      playHit(laneIndex);
      setLastJudgement(judgement);
    }
  }, []);

  const handlePointerDown = (laneIndex: number) => {
    if (isPaused) return;
    const key = LANE_KEYS[laneIndex];
    if (!activeKeys[key]) {
      setActiveKeys(prev => ({ ...prev, [key]: true }));
      if (gameState === 'playing') {
        handleHit(laneIndex);
      }
    }
  };

  const handlePointerUp = (laneIndex: number) => {
    const key = LANE_KEYS[laneIndex];
    setActiveKeys(prev => ({ ...prev, [key]: false }));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (LANE_KEYS.includes(key as LaneKey)) {
        if (!activeKeys[key]) {
          setActiveKeys(prev => ({ ...prev, [key]: true }));
          if (gameState === 'playing') {
            handleHit(LANE_KEYS.indexOf(key as LaneKey));
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (LANE_KEYS.includes(key as LaneKey)) {
        setActiveKeys(prev => ({ ...prev, [key]: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, handleHit, activeKeys]);

  const update = useCallback((time: number) => {
    if (gameState !== 'playing' || isPaused) return;

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const elapsed = time - startTimeRef.current - totalPauseDurationRef.current;

    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Lanes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * LANE_WIDTH, 0);
      ctx.lineTo(i * LANE_WIDTH, CANVAS_HEIGHT);
      ctx.stroke();
    }

    // Draw Hit Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, HIT_LINE_Y);
    ctx.lineTo(CANVAS_WIDTH, HIT_LINE_Y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw Hit Effects
    const now = performance.now();
    hitEffectsRef.current = hitEffectsRef.current.filter(eff => now - eff.time < 300);
    
    // Update Visualizer Data (Procedural)
    const baseFreq = (elapsed / 1000) * (selectedSong.bpm / 60);
    for (let i = 0; i < 32; i++) {
      const target = 10 + Math.sin(baseFreq * 2 + i * 0.5) * 15 + Math.random() * 10;
      visualizerRef.current[i] += (target - visualizerRef.current[i]) * 0.2;
    }

    // Draw Background Visualizer
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const barWidth = CANVAS_WIDTH / 32;
    visualizerRef.current.forEach((val, i) => {
      const h = val * 2;
      const x = i * barWidth;
      const gradient = ctx.createLinearGradient(x, CANVAS_HEIGHT, x, CANVAS_HEIGHT - h);
      gradient.addColorStop(0, `${LANE_COLORS[i % 4]}22`);
      gradient.addColorStop(1, `${LANE_COLORS[i % 4]}00`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x, CANVAS_HEIGHT - h, barWidth - 1, h);
    });
    ctx.restore();

    hitEffectsRef.current.forEach(eff => {
      const alpha = 1 - (now - eff.time) / 300;
      ctx.fillStyle = `${eff.color}${Math.floor(alpha * 0.15 * 255).toString(16).padStart(2, '0')}`;
      ctx.fillRect(eff.lane * LANE_WIDTH, 0, LANE_WIDTH, HIT_LINE_Y);
      
      ctx.shadowBlur = 20 * alpha;
      ctx.shadowColor = eff.color;
      ctx.strokeStyle = eff.color;
      ctx.lineWidth = 4 * alpha;
      ctx.strokeRect(eff.lane * LANE_WIDTH + 2, HIT_LINE_Y - 15, LANE_WIDTH - 4, 30);
      ctx.shadowBlur = 0;
    });

    // Update and Draw Notes
    notesRef.current.forEach(note => {
      if (note.hit) return;

      // Top-to-bottom: y increases as time approaches timestamp
      const y = HIT_LINE_Y - (note.timestamp - elapsed) * NOTE_SPEED;

      // Check for miss
      if (!note.missed && elapsed > note.timestamp + HIT_WINDOW_OKAY) {
        note.missed = true;
        setScore(s => ({ ...s, miss: s.miss + 1, combo: 0 }));
        setLastJudgement('MISS');
        setShake(10);
        playMiss();
      }

      // Only draw if on screen
      if (y > -50 && y < CANVAS_HEIGHT + 50) {
        ctx.fillStyle = LANE_COLORS[note.lane];
        ctx.shadowBlur = 15;
        ctx.shadowColor = LANE_COLORS[note.lane];
        
        const x = note.lane * LANE_WIDTH + LANE_WIDTH / 2;
        const size = 48;
        
        ctx.save();
        ctx.translate(x, y);
        // Rotate based on lane
        // Lane 0: Left, Lane 1: Down, Lane 2: Up, Lane 3: Right
        // Path is pointing Right by default
        if (note.lane === 0) ctx.rotate(Math.PI); // Left
        if (note.lane === 1) ctx.rotate(Math.PI * 0.5); // Down
        if (note.lane === 2) ctx.rotate(Math.PI * 1.5); // Up
        if (note.lane === 3) ctx.rotate(0); // Right
        
        // Draw Arrow Path centered
        const arrowSize = size;
        ctx.beginPath();
        // Pointing Right by default
        ctx.moveTo(arrowSize/2, 0); // Tip
        ctx.lineTo(-arrowSize/4, -arrowSize/2);
        ctx.lineTo(-arrowSize/4, -arrowSize/4);
        ctx.lineTo(-arrowSize/2, -arrowSize/4);
        ctx.lineTo(-arrowSize/2, arrowSize/4);
        ctx.lineTo(-arrowSize/4, arrowSize/4);
        ctx.lineTo(-arrowSize/4, arrowSize/2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        
        ctx.shadowBlur = 0;
      }
    });

    // Decay shake
    setShake(s => Math.max(0, s * 0.9));

    // Check for song end
    const lastNote = notesRef.current[notesRef.current.length - 1];
    if (lastNote && elapsed > lastNote.timestamp + 1000) {
      setGameState('results');
      saveToLeaderboard(score.score, score.maxCombo);
      if (menuPlayerRef.current) menuPlayerRef.current.playVideo();
    }

    requestRef.current = requestAnimationFrame(update);
  }, [gameState, score.score, score.maxCombo, leaderboard]);

  useEffect(() => {
    if (gameState !== 'playing' && playerRef.current) {
      playerRef.current.stopVideo();
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'playing' && !isPaused) {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, update, isPaused]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30 flex flex-col items-center justify-center p-4 overflow-hidden relative">
      {/* Persisted YouTube Players */}
      <div className="hidden pointer-events-none absolute opacity-0">
        <YouTube
          videoId={selectedSong.youtubeId}
          opts={{
            height: '0',
            width: '0',
            playerVars: {
              autoplay: 0,
              controls: 0,
              disablekb: 1,
              fs: 0,
              modestbranding: 1,
              rel: 0,
            },
          }}
          onReady={onPlayerReady}
          onStateChange={onPlayerStateChange}
        />
        <YouTube
          videoId="5O_O6v7-H-o" // Chill background music
          opts={{
            height: '0',
            width: '0',
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              modestbranding: 1,
              rel: 0,
              loop: 1,
              playlist: '5O_O6v7-H-o'
            },
          }}
          onReady={onMenuPlayerReady}
        />
      </div>

      {/* Version Tag & User Profile */}
      <div className="fixed top-6 right-6 z-[200] flex items-center gap-4">
        {gameState === 'playing' && (
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={togglePause}
            className="p-3 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-colors shadow-xl"
          >
            {isPaused ? <Play className="w-5 h-5 text-emerald-500" /> : <Pause className="w-5 h-5 text-zinc-400" />}
          </motion.button>
        )}
        {user ? (
          <div className={`flex items-center gap-3 bg-zinc-900/50 backdrop-blur-md border ${user.username === ADMIN_USERNAME ? 'border-orange-500/50 shadow-[0_0_20px_rgba(249,115,22,0.2)]' : 'border-zinc-800'} px-4 py-2 rounded-2xl relative`}>
            {user.username === ADMIN_USERNAME && (
              <>
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ 
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      x: [0, (i % 2 === 0 ? 1 : -1) * (20 + Math.random() * 20)],
                      y: [0, (i < 3 ? 1 : -1) * (20 + Math.random() * 20)],
                    }}
                    transition={{ 
                      duration: 2 + Math.random() * 2,
                      repeat: Infinity,
                      delay: i * 0.4
                    }}
                    className="absolute left-1/2 top-1/2 w-1 h-1 bg-orange-500 rounded-full blur-[1px]"
                  />
                ))}
              </>
            )}
            <div className={`w-8 h-8 rounded-full ${user.username === ADMIN_USERNAME ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]' : 'bg-blue-500'} flex items-center justify-center text-black font-black italic text-xs`}>
              {user.username[0].toUpperCase()}
            </div>
            <div className="text-left">
              <div className={`text-[10px] font-black italic tracking-tighter ${user.username === ADMIN_USERNAME ? 'text-orange-500' : 'text-blue-500'} uppercase leading-none`}>
                {user.username === ADMIN_USERNAME ? 'Admin Access' : `Level ${user.level || 1}`}
              </div>
              <div className="text-xs font-bold text-white flex items-center gap-1">
                {user.username}
                {user.username === ADMIN_USERNAME && (
                  <motion.span 
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="text-[8px] bg-orange-500 text-black px-1 rounded font-black"
                  >
                    STAFF
                  </motion.span>
                )}
              </div>
              <div className="w-16 h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div 
                  className="h-full bg-blue-500" 
                  style={{ width: `${((user.xp || 0) % 500) / 5}%` }}
                />
              </div>
            </div>
            <button 
              onClick={logout}
              className="ml-2 p-1 text-zinc-500 hover:text-rose-500 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button 
            onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
            className="flex items-center gap-2 bg-zinc-900/50 backdrop-blur-md border border-zinc-800 px-4 py-2 rounded-2xl hover:border-blue-500/50 transition-all group"
          >
            <LogIn className="w-4 h-4 text-zinc-500 group-hover:text-blue-500" />
            <span className="text-[10px] font-black italic tracking-tighter text-zinc-500 uppercase group-hover:text-white">Login / Register</span>
          </button>
        )}
        <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 px-3 py-1 rounded-full pointer-events-none">
          <span className="text-[10px] font-black italic tracking-tighter text-zinc-500 uppercase">Version</span>
          <span className="ml-2 text-[10px] font-black italic tracking-tighter text-blue-500">0.0.0.3</span>
        </div>
      </div>

      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />
      </div>

      <AnimatePresence mode="wait">
        {showAuthModal && (
          <motion.div
            key="auth-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 p-8 rounded-[32px] max-w-sm w-full relative overflow-hidden"
            >
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 blur-[100px]" />
              
              <button 
                onClick={() => setShowAuthModal(false)}
                className="absolute top-6 right-6 p-2 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="text-center mb-8">
                <h2 className="text-3xl font-black italic tracking-tighter uppercase mb-2">
                  {authMode === 'login' ? 'Welcome Back' : 'Join the Beat'}
                </h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  {authMode === 'login' ? 'Sign in to save your scores' : 'Create an account to compete'}
                </p>
              </div>

              <form onSubmit={handleAuth} className="space-y-4">
                {authMode === 'register' && (
                  <div>
                    <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2 block">Email Address</label>
                    <input 
                      type="email"
                      required
                      value={authForm.email}
                      onChange={e => setAuthForm(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="Enter email"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2 block">Username or Email</label>
                  <input 
                    type="text"
                    required
                    value={authForm.username}
                    onChange={e => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Enter username"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2 block">Password</label>
                  <input 
                    type="password"
                    required
                    value={authForm.password}
                    onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>

                {authError && (
                  <p className="text-rose-500 text-[10px] font-bold uppercase text-center">{authError}</p>
                )}

                <button 
                  type="submit"
                  className="w-full py-4 bg-white text-black font-black italic rounded-xl hover:bg-blue-400 transition-all active:scale-95"
                >
                  {authMode === 'login' ? 'LOGIN' : authMode === 'register' ? 'REGISTER' : 'RESET PASSWORD'}
                </button>
              </form>

              <div className="mt-6 space-y-4">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
                  <div className="relative flex justify-center text-[8px] uppercase font-bold tracking-widest"><span className="bg-zinc-900 px-2 text-zinc-600">Or continue with</span></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleSocialAuth('facebook')}
                    className="flex items-center justify-center gap-2 py-3 bg-[#1877F2] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
                  >
                    Facebook
                  </button>
                  <button 
                    onClick={() => setAuthMode('register')}
                    className="flex items-center justify-center gap-2 py-3 bg-zinc-800 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-700 transition-colors"
                  >
                    Email
                  </button>
                </div>
              </div>

              <div className="mt-6 text-center space-y-3">
                <button 
                  onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                  className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest hover:text-white transition-colors block w-full"
                >
                  {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
                </button>
                {authMode === 'login' && (
                  <button 
                    onClick={() => setAuthMode('forgot')}
                    className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest hover:text-zinc-400 transition-colors block w-full"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] bg-[#050505] flex flex-col items-center justify-center"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.1, 1],
                rotate: [0, 5, -5, 0]
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="relative mb-8"
            >
              <div className="text-6xl font-black italic tracking-tighter text-white">
                ARROW<span className="text-blue-500">BEATS!</span>
              </div>
              <div className="absolute -inset-4 bg-blue-500/20 blur-2xl rounded-full -z-10" />
            </motion.div>
            
            <div className="w-48 h-1 bg-zinc-900 rounded-full overflow-hidden relative">
              <motion.div
                initial={{ left: "-100%" }}
                animate={{ left: "100%" }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 w-1/2 bg-blue-500"
              />
            </div>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500 animate-pulse">
              Calibrating Rhythm...
            </p>
          </motion.div>
        ) : null}

        {/* Support Modal */}
        <AnimatePresence>
          {showSupport && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-zinc-900 border border-zinc-800 p-8 rounded-[32px] max-w-md w-full shadow-2xl relative"
              >
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 blur-[100px]" />
                
                <div className="flex justify-between items-center mb-8 relative">
                  <h2 className="text-3xl font-black italic tracking-tighter uppercase">Bug Support</h2>
                  <button onClick={() => setShowSupport(false)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="space-y-6 relative">
                  <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                    Found a bug? Describe it below and our team will investigate.
                  </p>
                  <textarea
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    placeholder="Describe the issue..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-white placeholder:text-zinc-700 focus:border-blue-500 outline-none transition-colors min-h-[150px] resize-none font-medium text-sm"
                  />
                  <button
                    onClick={async () => {
                      if (!supportMessage.trim()) return;
                      await fetch('/api/support', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: user?.username || 'Guest', message: supportMessage })
                      });
                      setSupportMessage('');
                      setShowSupport(false);
                      alert('Bug report sent! Thank you.');
                    }}
                    className="w-full py-4 bg-blue-500 text-black font-black italic rounded-xl hover:bg-blue-400 transition-all uppercase tracking-widest shadow-xl shadow-blue-500/20"
                  >
                    Send Report
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {showLeaderboard && (
          <motion.div
            key="leaderboard-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl max-w-md w-full relative"
            >
              <button 
                onClick={() => setShowLeaderboard(false)}
                className="absolute top-6 right-6 p-2 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-amber-500/10 rounded-xl">
                  <Trophy className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-2xl font-black italic tracking-tighter uppercase">Leaderboard</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Top 10 High Scores</p>
                </div>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600 uppercase text-xs font-bold tracking-widest">
                    No scores yet. <br /> Be the first to play!
                  </div>
                ) : (
                  leaderboard.map((entry, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black italic ${
                          idx === 0 ? 'bg-amber-500 text-black' :
                          idx === 1 ? 'bg-zinc-300 text-black' :
                          idx === 2 ? 'bg-amber-700 text-black' : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {idx + 1}
                        </div>
                        <div>
                          <div className="text-lg font-mono font-bold text-white leading-none">
                            {entry.score.toLocaleString()}
                          </div>
                          <div className="text-xs font-bold text-white flex items-center gap-1">
                            {entry.username}
                            {entry.username === ADMIN_USERNAME && (
                              <span className="text-[7px] bg-orange-500 text-black px-1 rounded font-black uppercase">Staff</span>
                            )}
                            <span className="text-zinc-500 mx-1">•</span>
                            {entry.song}
                            <span className="text-zinc-500 mx-1">•</span>
                            {entry.difficulty}
                          </div>
                        </div>
                      </div>
                      {idx < 3 && <Medal className={`w-5 h-5 ${
                        idx === 0 ? 'text-amber-500' :
                        idx === 1 ? 'text-zinc-300' : 'text-amber-700'
                      }`} />}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {gameState === 'menu' && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="z-10 text-center max-w-md w-full bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-10 rounded-[40px] shadow-2xl relative overflow-hidden"
          >
            {/* Menu Visualizer */}
            <div className="absolute bottom-0 left-0 right-0 h-32 flex items-end justify-center gap-1 px-4 opacity-20 pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    height: [20, 40 + Math.random() * 60, 20],
                  }}
                  transition={{ 
                    duration: 0.5 + Math.random() * 0.5, 
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="w-full bg-blue-500 rounded-t-sm"
                />
              ))}
            </div>

            {/* Background Glow */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/20 blur-[100px]" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/20 blur-[100px]" />

            <div className="mb-8 relative inline-block">
              <motion.h1 
                className="text-6xl font-black tracking-tighter italic uppercase text-white"
                animate={{ skewX: [-2, 2, -2] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                ARROW<br /><span className="text-blue-500">BEATS!</span>
              </motion.h1>
            </div>

            <div className="space-y-6 mb-10">
              {/* Song Selection */}
              <div className="text-left">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 block">Select Track</label>
                <div className="grid grid-cols-1 gap-2">
                  {SONGS.map(song => (
                    <button
                      key={song.id}
                      onClick={() => { setSelectedSong(song); playClick(); }}
                      className={`p-4 rounded-2xl border transition-all text-left flex items-center justify-between group ${
                        selectedSong.id === song.id 
                        ? 'bg-white border-white text-black' 
                        : 'bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-sm leading-none mb-1">{song.title}</div>
                        <div className={`text-[10px] font-bold uppercase tracking-widest ${selectedSong.id === song.id ? 'text-zinc-600' : 'text-zinc-500'}`}>
                          {song.artist} • {song.bpm} BPM
                        </div>
                      </div>
                      <Music className={`w-4 h-4 ${selectedSong.id === song.id ? 'text-black' : 'text-zinc-600 group-hover:text-zinc-400'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty Selection */}
              <div className="text-left">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 block">Difficulty</label>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTIES.map(diff => (
                    <button
                      key={diff.name}
                      onClick={() => { setSelectedDifficulty(diff); playClick(); }}
                      style={{ 
                        backgroundColor: selectedDifficulty.name === diff.name ? diff.color : 'transparent',
                        borderColor: diff.color,
                        color: selectedDifficulty.name === diff.name ? 'black' : diff.color
                      }}
                      className="px-3 py-2 rounded-xl border text-[10px] font-black italic tracking-tighter transition-all active:scale-95"
                    >
                      {diff.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <button
                onClick={startGame}
                disabled={!isMusicReady}
                className={`w-full py-5 font-black italic text-xl rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-3 group shadow-xl shadow-white/5 ${
                  isMusicReady 
                  ? 'bg-white text-black hover:bg-blue-400' 
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {isMusicReady ? (
                  <>
                    <Play className="w-6 h-6 fill-current group-hover:scale-110 transition-transform" />
                    PLAY NOW
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-6 h-6 animate-spin" />
                    LOADING MUSIC...
                  </>
                )}
              </button>
              
              <div className="flex justify-center gap-4">
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowLeaderboard(true)}
                  className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-500 shadow-lg shadow-amber-500/10 hover:border-amber-500/50 transition-colors"
                >
                  <Trophy className="w-8 h-8" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: -5 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowSupport(true)}
                  className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-blue-500 shadow-lg shadow-blue-500/10 hover:border-blue-500/50 transition-colors"
                >
                  <Bug className="w-8 h-8" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === 'playing' && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              transform: `translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)`
            }}
            className="z-10 flex flex-col items-center gap-8 w-full max-w-4xl"
          >
            {/* Header Stats */}
            <div className="w-full flex justify-between items-end px-4">
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">{selectedSong.title} • <span style={{ color: selectedDifficulty.color }} className="italic">{selectedDifficulty.name} MODE</span></div>
                <div className="flex items-center gap-2">
                  <div className={`text-4xl font-mono font-light tabular-nums ${selectedDifficulty.name === 'MASTER' ? 'text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'text-white'}`}>
                    {score.score.toLocaleString().padStart(7, '0')}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4 items-center">
                <div className="space-y-1 text-right">
                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Max Combo</div>
                  <div className={`text-2xl font-mono font-light tabular-nums ${selectedDifficulty.name === 'MASTER' ? 'text-orange-400' : 'text-zinc-400'}`}>
                    {score.maxCombo}
                  </div>
                </div>
              </div>
            </div>

            {/* Game Canvas Container */}
            <div className="relative bg-zinc-900/30 border-x border-zinc-800/50">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="block"
              />

              {/* Judgement Text Overlay */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <AnimatePresence mode="wait">
                  {lastJudgement && (
                    <motion.div
                      key={lastJudgement + Date.now()}
                      initial={{ opacity: 0, scale: 2, y: 0 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="flex flex-col items-center"
                    >
                      <div className={`text-6xl font-black italic tracking-tighter drop-shadow-2xl ${
                        lastJudgement.includes('PERFECT') ? 'text-[#FFD700] drop-shadow-[0_0_20px_rgba(255,215,0,0.8)]' :
                        lastJudgement.includes('GREAT') ? 'text-emerald-400' :
                        lastJudgement.includes('GOOD') ? 'text-blue-400' :
                        lastJudgement.includes('OKAY') ? 'text-amber-400' : 'text-rose-500'
                      }`}>
                        {lastJudgement.split(' ').pop()}
                      </div>
                      {lastJudgement.includes('EARLY') && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs font-black uppercase tracking-[0.4em] text-blue-400 mt-1 drop-shadow-md"
                        >
                          Early
                        </motion.div>
                      )}
                      {lastJudgement.includes('LATE') && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs font-black uppercase tracking-[0.4em] text-orange-400 mt-1 drop-shadow-md"
                        >
                          Late
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="text-7xl font-black italic tracking-tighter mt-4 h-20">
                  {score.combo > 0 && (
                    <motion.span
                      initial={{ scale: 1.5 }}
                      animate={{ scale: 1 }}
                      className={`inline-block ${selectedDifficulty.name === 'MASTER' ? 'text-orange-500 drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]' : 'text-white'}`}
                    >
                      {score.combo}x
                    </motion.span>
                  )}
                </div>
              </div>

              {/* Pause Overlay */}
              <AnimatePresence>
                {isPaused && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8"
                  >
                    <div className="text-4xl font-black italic tracking-tighter mb-8 uppercase">Paused</div>
                    <div className="space-y-3 w-full max-w-[240px]">
                      <button 
                        onClick={togglePause}
                        className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-blue-400 transition-colors flex items-center justify-center gap-2"
                      >
                        <Play className="w-5 h-5 fill-current" />
                        RESUME
                      </button>
                      <button 
                        onClick={startGame}
                        className="w-full py-4 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <RotateCcw className="w-5 h-5" />
                        RESTART
                      </button>
                      <button 
                        onClick={quitGame}
                        className="w-full py-4 bg-rose-500/10 text-rose-500 border border-rose-500/20 font-bold rounded-xl hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
                      >
                        <X className="w-5 h-5" />
                        QUIT
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* Lane Visual Indicators (Keys) */}
              <div className="absolute bottom-0 left-0 right-0 h-48 flex select-none touch-none">
                {LANE_KEYS.map((key, i) => {
                  const Icon = LANE_ICONS[i];
                  return (
                    <div 
                      key={key} 
                      onPointerDown={() => handlePointerDown(i)}
                      onPointerUp={() => handlePointerUp(i)}
                      onPointerLeave={() => handlePointerUp(i)}
                      className="flex-1 flex flex-col items-center justify-end pb-8 border-t border-zinc-800/50 active:bg-white/5 transition-colors"
                    >
                      <motion.div
                        animate={{
                          backgroundColor: activeKeys[key] ? LANE_COLORS[i] : 'transparent',
                          scale: activeKeys[key] ? 0.95 : 1,
                          boxShadow: activeKeys[key] ? `0 0 20px ${LANE_COLORS[i]}44` : 'none',
                          borderColor: activeKeys[key] ? 'transparent' : LANE_COLORS[i] + '44',
                        }}
                        className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center font-bold text-xl transition-colors duration-75 ${
                          activeKeys[key] ? 'text-black' : 'text-zinc-600'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </motion.div>
                      <span className="text-[10px] text-zinc-700 font-bold mt-2">{key.toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-[400px] h-1 bg-zinc-900 rounded-full overflow-hidden">
              {!isPaused && (
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: selectedSong.duration / 1000, ease: "linear" }}
                />
              )}
            </div>
          </motion.div>
        )}

        {gameState === 'results' && (
          <motion.div
            key="results"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="z-10 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 rounded-3xl max-w-xl w-full text-center shadow-2xl"
          >
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-blue-500/10 rounded-full">
                <Trophy className="w-12 h-12 text-blue-400" />
              </div>
            </div>
            
            {/* Results Header */}
            <div className="text-center mb-10">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-block px-6 py-2 bg-blue-500 text-black font-black italic text-sm rounded-full mb-4"
              >
                TRACK COMPLETE
              </motion.div>
              <h2 className="text-4xl font-black italic tracking-tighter mb-2 uppercase">Session Complete</h2>
              <p className="text-zinc-500 text-sm uppercase tracking-widest mb-4">{selectedSong.title} by {selectedSong.artist}</p>
              
              <div className="flex justify-center gap-4 mt-6">
                {score.miss === 0 && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="px-4 py-2 bg-amber-500 text-black font-black italic text-xs rounded-lg shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                  >
                    FULL COMBO
                  </motion.div>
                )}
                {score.miss === 0 && score.great === 0 && score.good === 0 && score.okay === 0 && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.7 }}
                    className="px-4 py-2 bg-white text-black font-black italic text-xs rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  >
                    ALL PERFECT
                  </motion.div>
                )}
              </div>
            </div>
            <p style={{ color: selectedDifficulty.color }} className="text-[10px] uppercase tracking-widest mb-12 font-black italic">{selectedDifficulty.name} DIFFICULTY</p>

            <div className="grid grid-cols-2 gap-8 mb-12">
              <div className="text-left space-y-3">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Perfect</span>
                  <span className="text-amber-400 font-mono font-bold">{score.perfect}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Great</span>
                  <span className="text-emerald-400 font-mono font-bold">{score.great}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Good</span>
                  <span className="text-blue-400 font-mono font-bold">{score.good}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Okay</span>
                  <span className="text-amber-600 font-mono font-bold">{score.okay}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                  <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Miss</span>
                  <span className="text-rose-500 font-mono font-bold">{score.miss}</span>
                </div>
              </div>
              
                <div className="flex flex-col justify-center items-center bg-white/5 rounded-2xl p-6 border border-white/5 shadow-inner">
                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Final Score</div>
                  <div className={`text-4xl font-black italic tracking-tighter ${selectedDifficulty.name === 'MASTER' ? 'text-orange-500' : 'text-white'}`}>
                    {score.score.toLocaleString()}
                  </div>
                  <div className="mt-4 text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Best Combo</div>
                  <div className="text-2xl font-black italic tracking-tighter text-zinc-400">
                    {score.maxCombo}
                  </div>
                </div>
            </div>

            <div className="flex gap-4 mb-4">
              <button
                onClick={startGame}
                className="flex-1 py-4 bg-white text-black font-bold rounded-xl hover:bg-blue-400 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" /> RETRY
              </button>
              <button
                onClick={() => setGameState('menu')}
                className="flex-1 py-4 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-all"
              >
                MENU
              </button>
            </div>

            <div className="flex justify-center">
              <motion.button
                whileHover={{ scale: 1.1, rotate: -5 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowLeaderboard(true)}
                className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-500 hover:border-amber-500/50 transition-colors"
              >
                <Trophy className="w-6 h-6" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <div className="fixed bottom-6 text-[10px] text-zinc-600 font-bold uppercase tracking-[0.3em] pointer-events-none">
        Neon Rhythm Engine • 2026
      </div>
    </div>
  );
}
