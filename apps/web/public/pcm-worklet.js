// Continuous mono capture -> 16 kHz signed little-endian PCM, 32 ms frames.
// Fractional accumulator survives render quanta (44.1/48/other kHz contexts).
class SayGoPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(512);
    this.cursor = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.sum += sample;
      this.count++;
      this.phase++;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.cursor++] = Math.round(
          value * (value < 0 ? 32768 : 32767),
        );
        this.sum = 0;
        this.count = 0;
        if (this.cursor === 512) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Int16Array(512);
          this.cursor = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("saygo-pcm", SayGoPCM);
