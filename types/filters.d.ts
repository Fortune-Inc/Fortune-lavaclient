/**
 * LAVALINK DEV FEATURE
 */
import { EqualizerBand } from "./misc";

export interface Filters {
  equalizer?: EqualizerBand[];
  timescale?: TimescaleFilter | null;
  tremolo?: TremoloFilter | null;
  volume?: number;
  karaoke?: KaraokeFilter | null;
  rotation?: RotationFilter | null;
  distortion?: DistortionFilter | null;
}

export type EqualizerFilter = EqualizerBand[];

export type VolumeFilter = number;

export interface TimescaleFilter {
  pitch?: number;
  rate?: number;
  speed?: number;
}

export interface TremoloFilter {
  depth?: number;
  frequency?: number;
}

export interface KaraokeFilter {
  level?: number;
  monoLevel?: number;
  filterBand?: number;
  filterWidth?: number;
}

export interface RotationFilter {
  rotationHz?: number;
}

export interface DistortionFilter {
  sinOffset?: number,
  sinScale?: number,
  cosOffset?: number,
  cosScale?: number,
  tanOffset?: number,
  tanScale?: number,
  offset?: number,
  scale?: number
}