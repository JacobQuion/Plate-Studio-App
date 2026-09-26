import { runFfmpeg } from "@/lib/ffmpeg";

/**
 * Procedural music bed: a warm four-chord loop (C - Am - F - G) at 100 BPM with a
 * soft kick, clap and hi-hat, synthesized entirely by FFmpeg's aevalsrc.
 * Royalty-free by construction, and it needs no bundled audio files.
 *
 * The pipeline ducks it under the voiceover with sidechaincompress.
 */

export const MUSIC_BPM = 100;
const BEAT = 60 / MUSIC_BPM;
const BAR = BEAT * 4;

// Triads per bar and the bass root (one octave below the chord root).
const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
];
const ROOTS = [130.81, 110.0, 87.31, 98.0];

/** if(eq(K,0),a,if(eq(K,1),b,...)) where K is the current bar in the 4-bar loop. */
function perBar(values: number[]): string {
  const K = `mod(floor(t/${BAR}),4)`;
  return values.reduceRight((acc, v, i) => (i === values.length - 1 ? `${v}` : `if(eq(${K},${i}),${v},${acc})`), "");
}

function musicExpression(): string {
  const X = `mod(t,${BAR})`; // time within the bar
  const envPad = `min(1,${X}/0.08)*min(1,(${BAR}-${X})/0.35)`;
  const pad = [0, 1, 2].map((n) => `sin(2*PI*${perBar(CHORDS.map((c) => c[n]))}*t)`).join("+");
  const shimmer = `0.35*sin(2*PI*2*${perBar(CHORDS.map((c) => c[2]))}*t)`;

  const Y = `mod(t,${BEAT})`; // time since the last beat
  const bass = `0.22*sin(2*PI*${perBar(ROOTS)}*t)*exp(-3.5*${Y})*min(1,${Y}/0.006)`;

  const K2 = `mod(t,${BEAT * 2})`; // kick on beats 1 and 3
  const kick = `0.55*sin(2*PI*(48*${K2}+4.4*(1-exp(-26*${K2}))))*exp(-9*${K2})`;

  const C2 = `mod(t+${BEAT},${BEAT * 2})`; // clap on beats 2 and 4
  const clap = `0.10*(2*random(0)-1)*exp(-22*${C2})`;

  const H = `mod(t+${BEAT / 2},${BEAT})`; // hats on the off-beat eighths
  const hat = `0.035*(2*random(1)-1)*exp(-70*${H})`;

  return `0.045*(${pad}+${shimmer})*${envPad}+${bass}+${kick}+${clap}+${hat}`;
}

/** Render `seconds` of music to a stereo WAV at `outPath`. */
export async function renderMusicBed(outPath: string, seconds: number): Promise<string> {
  const d = seconds.toFixed(2);
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `aevalsrc='${musicExpression()}':s=44100:d=${d}`,
    "-af", [
      "highpass=f=35",
      "lowpass=f=7000",
      "aecho=0.8:0.5:180|360:0.22|0.12",
      "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo",
      "afade=in:st=0:d=1.2",
      `afade=out:st=${Math.max(0, seconds - 2.5).toFixed(2)}:d=2.5`,
      "alimiter=limit=0.8",
    ].join(","),
    "-t", d,
    outPath,
  ]);
  return outPath;
}
