// Copia tudo o que vai para os altifalantes (de todos os AudioContext da página: a música e a contagem)
// para uma mistura única, gravada com MediaRecorder, para juntar o som ao vídeo.
(() => {
  const taps = new WeakMap();
  const orig = AudioNode.prototype.connect;
  let mixer = null, mixDest = null;
  const mix = () => { if (!mixer) { mixer = new AudioContext(); mixDest = mixer.createMediaStreamDestination(); window.__tap = mixDest; } };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && dest.context !== mixer) {
      const ctx = dest.context; let t = taps.get(ctx);
      if (!t) {
        mix(); t = ctx.createMediaStreamDestination(); taps.set(ctx, t);
        orig.call(mixer.createMediaStreamSource(t.stream), mixDest);
      }
      orig.call(this, t);
    }
    return r;
  };
  window.__recStart = () => {
    void mixer.resume();
    const rec = new MediaRecorder(mixDest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
    window.__chunks = []; rec.ondataavailable = e => window.__chunks.push(e.data); rec.start(250); window.__rec = rec; return Date.now();
  };
  window.__recStop = () => new Promise(res => {
    window.__rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(window.__chunks).arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      res(btoa(s));
    };
    window.__rec.stop();
  });
})();
