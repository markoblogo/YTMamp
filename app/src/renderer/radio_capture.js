/* AudioWorklet: fixed stereo 48 kHz PCM, delivered in bounded chunks. */
class RadioCapture extends AudioWorkletProcessor {
    constructor() {
        super(); this.active = false; this.offset = 0; this.buffer = new Float32Array(8192);
        this.port.onmessage = ({ data }) => { this.active = data === true; this.offset = 0; };
    }
    process(inputs) {
        const channels = inputs[0];
        if (!this.active || !channels?.length) return true;
        for (let frame = 0; frame < channels[0].length; frame++) {
            this.buffer[this.offset++] = channels[0][frame];
            this.buffer[this.offset++] = (channels[1] || channels[0])[frame];
            if (this.offset === this.buffer.length) { this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(8192); this.offset = 0; }
        }
        return true;
    }
}
registerProcessor('radio-capture', RadioCapture);
