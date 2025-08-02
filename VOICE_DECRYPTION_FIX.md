# Discord Voice Decryption Fix

## Problem
The Discord voice system was failing to decrypt all incoming audio packets with the error "Failed to decrypt audio data". This was preventing any voice transcription from working.

## Root Cause
The nonce construction for Discord's `xsalsa20_poly1305_lite` encryption mode was incorrect. The original implementation was simply padding the 4-byte nonce suffix with zeros, but Discord requires a specific nonce structure.

## Solution
Fixed the nonce construction in `audioDecodingWorker.ts`:

```typescript
// For xsalsa20_poly1305_lite, the nonce is constructed differently
// Discord uses a 24-byte nonce where the first 12 bytes are the RTP header
// and the last 12 bytes are zeros, then XORed with the 4-byte suffix
const nonce = Buffer.alloc(24);

// Copy RTP header (first 12 bytes) to nonce
rtpPacket.copy(nonce, 0, 0, 12);

// Copy the 4-byte nonce suffix to the correct position (bytes 12-15)
nonceBuffer.copy(nonce, 12);
```

## Key Changes
1. **Nonce Structure**: The 24-byte nonce now includes the RTP header as the first 12 bytes
2. **Suffix Position**: The 4-byte nonce suffix is placed at bytes 12-15 instead of bytes 0-3
3. **Enhanced Logging**: Added debug logging to help diagnose decryption issues

## Testing
After this fix, the Discord voice system should:
- Successfully decrypt incoming audio packets
- No longer show "Failed to decrypt audio data" errors
- Properly forward audio to the transcription pipeline

## Additional Improvements
- Added SSRC to user ID mapping for proper user identification
- Implemented silence packet detection to avoid processing empty audio
- Enhanced error logging for better debugging

## Related Files
- `src/audioDecodingWorker.ts` - Main decryption logic
- `src/threadedWebrtcVoiceHandler.ts` - Voice connection handling
- `src/transcriptStore.ts` - Transcript storage system