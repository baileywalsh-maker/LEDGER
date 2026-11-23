// ============================================================
// Tap sound — a soft bubble pop: fast pitch RISE, short decay, sine
// through a lowpass. Built in the browser so there is no file to load.
// ============================================================

// ============================================================
// Haptics. Deliberately rare: the tap sound fires on every control, so a
// second signal on every control would say nothing. This one fires ONLY where
// something is written — a food logged, a statement imported, a day confirmed
// — so the buzz means "that went in", every time, and nothing else.
// ============================================================
const HAPTIC_KEY = 'ledger:haptic';
function hapticsOn(){ return localStorage.getItem(HAPTIC_KEY) !== 'off'; }
function buzz(kind){
  if(!hapticsOn()) return;
  try{
    if(!navigator.vibrate) return;      // iOS Safari ignores this; harmless
    navigator.vibrate(kind === 'big' ? [14, 40, 14] : 12);
  }catch(e){}
}

const SOUND_KEY = 'ledger:sound';
const soundOn = ()=> localStorage.getItem(SOUND_KEY) !== 'off';
let audioCtx = null;
// ============================================================
// Sounds (v51) — all made in code, so they work offline and weigh nothing.
// Tap sound: the wood click COACH uses. Moment sounds: one per kind of event,
// each with its own switch in Settings ("Moment sounds").
// ============================================================
const FX_KEY = 'ledger:fx';
const fxOn = ()=>{ try{ return localStorage.getItem(FX_KEY) !== 'off'; }catch(e){ return true; } };
let sfxMaster = null, sfxNoise = null;
function sfxCtx(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  if(!audioCtx) audioCtx = new AC();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  if(!sfxMaster){
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    sfxMaster = audioCtx.createGain(); sfxMaster.gain.value = 0.6;
    sfxMaster.connect(comp); comp.connect(audioCtx.destination);
    sfxNoise = audioCtx.createBuffer(1, audioCtx.sampleRate*2, audioCtx.sampleRate);
    const d = sfxNoise.getChannelData(0); for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  }
  return audioCtx;
}
const sR = (a,b)=> a + Math.random()*(b-a);
function sEnv(t, peak, attack, decay){
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak,0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(sfxMaster);
  return g;
}
function sTone(t, f, dur, o={}){
  const osc = audioCtx.createOscillator(); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f, t);
  if(o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || dur));
  const g = sEnv(t, o.gain ?? 0.3, o.attack ?? 0.003, dur);
  let node = osc;
  if(o.lp){ const lp = audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=o.lp; osc.connect(lp); node = lp; }
  node.connect(g); osc.start(t); osc.stop(t + (o.attack ?? 0.003) + dur + 0.05);
}
function sNoise(t, dur, o={}){
  const src = audioCtx.createBufferSource(); src.buffer = sfxNoise;
  const f = audioCtx.createBiquadFilter(); f.type = o.type || 'bandpass';
  f.frequency.setValueAtTime(o.f || 1000, t);
  if(o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  f.Q.value = o.q ?? 1;
  const g = sEnv(t, o.gain ?? 0.3, o.attack ?? 0.002, dur);
  src.connect(f); f.connect(g);
  src.start(t, Math.random()*1.5); src.stop(t + (o.attack ?? 0.002) + dur + 0.05);
}
function sBell(t, f, gain, decay){
  [[1,1],[2.0,.5],[3.0,.25],[4.2,.15]].forEach(([r,a],i)=> sTone(t, f*r, decay/(1+i*0.6), {gain:gain*a, attack:0.002}));
}
function sThud(t, f, gain, dur){
  sTone(t, f, dur, {f2:f*0.5, gain, attack:0.004});
  sNoise(t, dur*0.6, {type:'lowpass', f:f*2.5, gain:gain*0.9, attack:0.003});
}
function sChing(t, f, gain, decay){
  [[1,1,1],[1.004,.7,1],[2.01,.45,.6],[2.76,.3,.45],[4.07,.18,.3],[5.4,.1,.22]].forEach(([r,a,d])=>
    sTone(t, f*r, decay*d, {gain:gain*a, attack:0.002}));
  sNoise(t, 0.02, {type:'highpass', f:6000, gain:gain*0.5});
}
function sClink(t, base, gain, decay){
  [[1,1],[2.76,.55],[5.40,.32],[8.93,.18]].forEach(([r,a],i)=> sTone(t, base*r, decay/Math.sqrt(i+1), {gain:gain*a, attack:0.001}));
  sNoise(t, 0.006, {type:'highpass', f:5000, gain:gain*0.6});
}
const SFX = {
  // every tap — kept well below the moment sounds
  wood(t){
    sTone(t, 820, 0.035, {type:'triangle', f2:600, gain:0.09});
    sTone(t, 360, 0.04, {gain:0.04});
    sNoise(t, 0.012, {type:'bandpass', f:1800, q:3, gain:0.08});
  },
  // net worth up
  arcade(t){
    sTone(t, 988, 0.07, {type:'square', gain:0.07, lp:5000});
    sTone(t + 0.07, 1319, 0.45, {type:'square', gain:0.07, lp:5000});
    for(let i=0;i<5;i++) sChing(t + 0.12 + i*0.05, 3000 + i*400, 0.025, 0.25);
  },
  // weekly check-in finished. A second body hit at 130Hz so it still lands
  // on a phone speaker, which cannot play the deep boom underneath.
  book(t){
    sNoise(t, 0.3, {type:'bandpass', f:450, f2:120, q:0.7, gain:0.16, attack:0.2});
    const hit = t + 0.32;
    sThud(hit, 62, 1.0, 0.45);
    sThud(hit, 130, 0.5, 0.22);
    sTone(hit, 42, 0.7, {f2:30, gain:0.8, attack:0.006});
    sNoise(hit, 0.12, {type:'lowpass', f:320, gain:0.9, attack:0.002});
    sNoise(hit, 0.06, {type:'bandpass', f:900, q:0.8, gain:0.22});
    sNoise(hit + 0.02, 0.9, {type:'lowpass', f:110, gain:0.28, attack:0.02});
  },
  // statement imported
  typewriter(t){
    let at = t;
    for(let i=0;i<7;i++){
      sNoise(at, 0.012, {type:'highpass', f:2400, gain:0.38});
      sTone(at, 210, 0.035, {type:'triangle', gain:0.16});
      at += sR(0.07, 0.14);
    }
    sBell(at + 0.05, 2794, 0.13, 1.0);
  },
  // spending logged — quiet on purpose
  pencil(t){
    sNoise(t, 0.05, {type:'bandpass', f:3200, f2:4300, q:2.5, gain:0.12, attack:0.012});
    sNoise(t + 0.07, 0.03, {type:'bandpass', f:3800, f2:4600, q:2.5, gain:0.08, attack:0.008});
  },
  // backup saved
  safe(t){
    for(let i=0;i<5;i++){
      sNoise(t + i*0.075, 0.006, {type:'highpass', f:3000, gain:0.3});
      sTone(t + i*0.075, 1500, 0.015, {gain:0.04});
    }
    const c = t + 0.48;
    sThud(c, 120, 0.6, 0.15);
    sNoise(c, 0.08, {type:'lowpass', f:700, gain:0.4});
    sClink(c, 900, 0.14, 0.22);
  },
  // a category just went over its budget
  lownote(t){
    sTone(t, 523, 0.2, {type:'triangle', gain:0.14, lp:1500, attack:0.01});
    sTone(t + 0.17, 392, 0.32, {type:'triangle', gain:0.14, lp:1400, attack:0.01});
  },
  // net worth passed a new £10k mark
  milestone(t){
    for(let i=0;i<6;i++) sNoise(t + i*0.011, 0.01, {type:'bandpass', f:sR(3500,6500), q:2, gain:0.32*(1-i/8)});
    sTone(t, 160, 0.06, {f2:110, gain:0.26});
    sNoise(t, 0.05, {type:'lowpass', f:700, gain:0.19});
    sChing(t + 0.11, 2637, 0.16, 1.4);
    sChing(t + 0.115, 3951, 0.07, 1.0);
    [1047,1319,1568,2093].forEach((f,i)=> sBell(t + 0.6 + i*0.1, f, 0.1, 1.4));
  },
};
// Several things can happen in one action (an import that also lifts net worth
// past a milestone). Anything asked for within 60ms collapses to the most
// important one, so sounds never pile on top of each other.
const SFX_RANK = {milestone:6, book:5, typewriter:4, safe:3, lownote:3, arcade:2, pencil:1};
let sfxPending = null, sfxTimer = null;
function sfx(name){
  if(!fxOn() || !SFX[name]) return;
  if(!sfxPending || (SFX_RANK[name]||0) > (SFX_RANK[sfxPending]||0)) sfxPending = name;
  clearTimeout(sfxTimer);
  sfxTimer = setTimeout(()=>{
    const n = sfxPending; sfxPending = null;
    try{ if(sfxCtx()) SFX[n](audioCtx.currentTime + 0.02); }catch(e){}
  }, 60);
}
function pop(){
  if(!soundOn()) return;
  try{ if(sfxCtx()) SFX.wood(audioCtx.currentTime + 0.005); }catch(e){}
}
// `click`, not `pointerdown` — a pointerdown fires the moment a finger lands, so
// brushing past or starting a scroll would trigger it.
document.addEventListener('click', e=>{
  if(e.target.closest('button, .chip, .lrow.tap, .nav button, .fold-h')) pop();
}, true);
