import { describe, it, expect, beforeEach } from 'vitest';
import { SoundscapeEngine } from './soundscape';

describe('SoundscapeEngine', () => {
  let soundscape: SoundscapeEngine;

  beforeEach(() => {
    localStorage.clear();
    soundscape = new SoundscapeEngine();
  });

  it('should initialize with default volume and mute state', () => {
    expect(soundscape.getMuted()).toBe(false);
    expect(soundscape.getVolume()).toBe(0.6);
  });

  it('should toggle and persist mute state', () => {
    const isMuted = soundscape.toggleMute();
    expect(isMuted).toBe(true);
    expect(soundscape.getMuted()).toBe(true);
    expect(localStorage.getItem('visualizer_sound_muted')).toBe('true');

    soundscape.toggleMute();
    expect(soundscape.getMuted()).toBe(false);
  });

  it('should adjust and clamp volume levels', () => {
    soundscape.setVolume(0.85);
    expect(soundscape.getVolume()).toBe(0.85);
    expect(localStorage.getItem('visualizer_sound_volume')).toBe('0.85');

    // Clamping checks
    soundscape.setVolume(1.5);
    expect(soundscape.getVolume()).toBe(1.0);

    soundscape.setVolume(-0.2);
    expect(soundscape.getVolume()).toBe(0.0);
  });

  it('should safely handle sound playback calls in jsdom / mock environments without crashing', () => {
    expect(() => soundscape.playThinkClick()).not.toThrow();
    expect(() => soundscape.playLaserCut()).not.toThrow();
    expect(() => soundscape.playPhoneRing()).not.toThrow();
    expect(() => soundscape.playIntercom()).not.toThrow();
    expect(() => soundscape.playTestRun(true)).not.toThrow();
    expect(() => soundscape.playEmergencyStop()).not.toThrow();
  });
});
