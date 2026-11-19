/**
 * WavRecorder
 * Captures microphone audio via Web Audio API and encodes it directly to
 * a 16-bit PCM WAV blob in the browser. This sidesteps browser-dependent
 * compressed formats (webm/opus) entirely, so the server never needs
 * ffmpeg — soundfile can read the WAV natively.
 */
class WavRecorder {
  constructor() {
    this.audioContext = null;
    this.stream = null;
    this.processor = null;
    this.input = null;
    this.buffers = [];
    this.sampleRate = 44100;
    this.recording = false;
  }

  async start(onLevel) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = this.audioContext.sampleRate;
    this.input = this.audioContext.createMediaStreamSource(this.stream);

    // ScriptProcessorNode is deprecated but remains universally supported;
    // it's the simplest reliable way to get raw Float32 PCM frames.
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.buffers = [];
    this.recording = true;

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const channelData = e.inputBuffer.getChannelData(0);
      this.buffers.push(new Float32Array(channelData));
      if (onLevel) onLevel(channelData);
    };

    this.input.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    this.recording = false;
    if (this.processor) this.processor.disconnect();
    if (this.input) this.input.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());

    const sampleRate = this.sampleRate;
    if (this.audioContext) this.audioContext.close();

    const length = this.buffers.reduce((acc, b) => acc + b.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const b of this.buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    return {
      blob: this._encodeWav(merged, sampleRate),
      durationSeconds: length / sampleRate,
    };
  }

  _encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([view], { type: "audio/wav" });
  }
}
