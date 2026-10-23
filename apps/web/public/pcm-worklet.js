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
    this.enabled = true;
    this.port.onmessage = ({ data }) => {
      if (
        data?.type !== "capture_state" ||
        typeof data.enabled !== "boolean" ||
        typeof data.request_id !== "string"
      )
        return;
      // A seal preserves every sample already captured, including the partial
      // final frame. Pausing without a seal discards pre-confirmation samples.
      if (data.flush === true && !data.enabled && this.cursor) {
        const tail = this.frame.slice(0, this.cursor);
        this.port.postMessage(tail.buffer, [tail.buffer]);
      }
      this.enabled = data.enabled;
      this.phase = 0;
      this.sum = 0;
      this.count = 0;
      this.frame = new Int16Array(512);
      this.cursor = 0;
      this.port.postMessage({
        type: "capture_state",
        enabled: this.enabled,
        request_id: data.request_id,
      });
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || !this.enabled) return true;
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
