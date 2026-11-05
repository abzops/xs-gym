import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneAccessError, requestMicrophone } from './voice';

afterEach(() => vi.unstubAllGlobals());

describe('XS AI microphone permission', () => {
  it('requests the native microphone and immediately releases its tracks', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await requestMicrophone();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('turns an OS denial into an in-app recoverable state', async () => {
    const getUserMedia = vi.fn(async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'denied',
    } satisfies Partial<MicrophoneAccessError>);
  });

  it('distinguishes missing hardware from permission denial', async () => {
    const getUserMedia = vi.fn(async () => {
      const error = new Error('No device');
      error.name = 'NotFoundError';
      throw error;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'missing',
    });
  });

  it('explains microphone unavailability without opening Settings', async () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'unsupported',
    });
  });
});
