export class JitterBuffer {
  private buffer: Buffer[] = [];
  private targetSize: number;
  private maxSize: number;
  private underrunCount = 0;
  private overrunCount = 0;
  
  constructor(targetSize = 3, maxSize = 10) {
    this.targetSize = targetSize;
    this.maxSize = maxSize;
  }
  
  addFrame(frame: Buffer): void {
    if (this.buffer.length >= this.maxSize) {
      // Buffer overrun - drop oldest frame
      this.buffer.shift();
      this.overrunCount++;
      console.warn('[JitterBuffer] Buffer overrun, dropped frame');
    }
    
    this.buffer.push(frame);
  }
  
  getFrame(): Buffer | null {
    if (this.buffer.length === 0) {
      this.underrunCount++;
      console.warn('[JitterBuffer] Buffer underrun');
      return null;
    }
    
    // Only start outputting when we have enough frames buffered
    if (this.buffer.length < this.targetSize) {
      return null;
    }
    
    return this.buffer.shift() || null;
  }
  
  getStats(): { size: number; underruns: number; overruns: number } {
    return {
      size: this.buffer.length,
      underruns: this.underrunCount,
      overruns: this.overrunCount
    };
  }
  
  clear(): void {
    this.buffer = [];
    this.underrunCount = 0;
    this.overrunCount = 0;
  }
}