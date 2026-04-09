use core::f32::consts::PI;

const MAX_FRAMES: usize = 512;
const MAX_BANDS: usize = 40;
const PCM_NORMALIZATION: f32 = 32768.0;
const MIN_LISSAJOUS_SCALE: f32 = 0.05;
const MAX_LISSAJOUS_SCALE: f32 = 1.0;

static mut INPUT: [i16; MAX_FRAMES * 2] = [0; MAX_FRAMES * 2];
static mut OUTPUT: [f32; MAX_FRAMES * 2] = [0.0; MAX_FRAMES * 2];
static mut BANDS: [f32; MAX_BANDS] = [0.0; MAX_BANDS];

fn windowed_mono_sample(index: usize, frame_count: usize) -> f32 {
    let left = unsafe { INPUT[index * 2] } as f32 / PCM_NORMALIZATION;
    let right = unsafe { INPUT[(index * 2) + 1] } as f32 / PCM_NORMALIZATION;
    let window = if frame_count > 1 {
        let phase = (2.0 * PI * index as f32) / (frame_count - 1) as f32;
        0.5 - (0.5 * phase.cos())
    } else {
        1.0
    };

    ((left + right) * 0.5) * window
}

fn goertzel_magnitude(frame_count: usize, sample_rate: f32, target_frequency: f32) -> f32 {
    if frame_count < 2
        || !sample_rate.is_finite()
        || sample_rate <= 1.0
        || !target_frequency.is_finite()
        || target_frequency <= 0.0
        || target_frequency >= sample_rate * 0.5
    {
        return 0.0;
    }

    let omega = (2.0 * PI * target_frequency) / sample_rate;
    let coeff = 2.0 * omega.cos();
    let mut q1 = 0.0;
    let mut q2 = 0.0;

    for index in 0..frame_count {
        let sample = windowed_mono_sample(index, frame_count);
        let q0 = (coeff * q1) - q2 + sample;
        q2 = q1;
        q1 = q0;
    }

    let power = (q1 * q1) + (q2 * q2) - (coeff * q1 * q2);
    power.max(0.0).sqrt() / frame_count as f32
}

fn band_center_frequency(
    band_index: usize,
    band_count: usize,
    min_frequency: f32,
    max_frequency: f32,
) -> f32 {
    if band_count <= 1 || min_frequency <= 0.0 || max_frequency <= min_frequency {
        return min_frequency.max(1.0);
    }

    let exponent = band_index as f32 / (band_count - 1) as f32;
    min_frequency * (max_frequency / min_frequency).powf(exponent)
}

fn normalized_equalizer_level(magnitude: f32, band_index: usize, band_count: usize) -> f32 {
    let high_band_emphasis = if band_count > 1 {
        1.0 + ((band_index as f32 / (band_count - 1) as f32) * 0.45)
    } else {
        1.0
    };

    let compressed = (1.0 + (magnitude * high_band_emphasis * 28.0)).ln() / 3.45;
    compressed.clamp(0.0, 1.0)
}

#[no_mangle]
pub extern "C" fn max_frames() -> usize {
    MAX_FRAMES
}

#[no_mangle]
pub extern "C" fn max_bands() -> usize {
    MAX_BANDS
}

#[no_mangle]
pub extern "C" fn input_ptr() -> *mut i16 {
    core::ptr::addr_of_mut!(INPUT).cast::<i16>()
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const f32 {
    core::ptr::addr_of!(OUTPUT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn band_output_ptr() -> *const f32 {
    core::ptr::addr_of!(BANDS).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn render_lissajous(
    frame_count: usize,
    width: f32,
    height: f32,
    gain: f32,
    scale: f32,
) -> usize {
    let safe_frame_count = frame_count.min(MAX_FRAMES);
    let center_x = width * 0.5;
    let center_y = height * 0.5;
    let clamped_gain = gain.clamp(0.28, 1.24);
    let clamped_scale = if scale.is_finite() {
        scale.clamp(MIN_LISSAJOUS_SCALE, MAX_LISSAJOUS_SCALE)
    } else {
        0.25
    };
    let radius = width.min(height) * 0.34 * clamped_gain * clamped_scale;

    unsafe {
        for index in 0..safe_frame_count {
            let left = INPUT[index * 2] as f32 / PCM_NORMALIZATION;
            let right = INPUT[(index * 2) + 1] as f32 / PCM_NORMALIZATION;

            OUTPUT[index * 2] = center_x + (left * radius);
            OUTPUT[(index * 2) + 1] = center_y - (right * radius);
        }
    }

    safe_frame_count
}

#[no_mangle]
pub extern "C" fn render_equalizer(
    frame_count: usize,
    sample_rate: f32,
    sample_stride: f32,
) -> usize {
    let safe_frame_count = frame_count.min(MAX_FRAMES);
    let stride = if sample_stride.is_finite() {
        sample_stride.max(1.0)
    } else {
        1.0
    };
    let base_sample_rate = if sample_rate.is_finite() && sample_rate > 64.0 {
        sample_rate
    } else {
        64.0
    };
    let effective_sample_rate = (base_sample_rate / stride).max(64.0);

    unsafe {
        for band_index in 0..MAX_BANDS {
            BANDS[band_index] = 0.0;
        }
    }

    if safe_frame_count < 8 {
        return MAX_BANDS;
    }

    let nyquist = effective_sample_rate * 0.5;
    let min_frequency = (nyquist * 0.14).min(26.0).max(12.0);
    let max_frequency = (nyquist * 0.975).max(min_frequency * 2.2);
    let taps = [
        (0.78_f32, 0.22_f32),
        (0.92_f32, 0.36_f32),
        (1.0_f32, 0.56_f32),
        (1.08_f32, 0.36_f32),
        (1.24_f32, 0.22_f32),
    ];

    unsafe {
        for band_index in 0..MAX_BANDS {
            let center = band_center_frequency(band_index, MAX_BANDS, min_frequency, max_frequency);
            let mut weighted_sum = 0.0;
            let mut total_weight = 0.0;

            for (ratio, weight) in taps {
                let frequency = (center * ratio).min(max_frequency);
                weighted_sum +=
                    goertzel_magnitude(safe_frame_count, effective_sample_rate, frequency) * weight;
                total_weight += weight;
            }

            let magnitude = if total_weight > 0.0 {
                weighted_sum / total_weight
            } else {
                0.0
            };
            BANDS[band_index] = normalized_equalizer_level(magnitude, band_index, MAX_BANDS);
        }
    }

    MAX_BANDS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_sine_wave(frequency: f32, sample_rate: f32, frame_count: usize) {
        unsafe {
            for index in 0..frame_count.min(MAX_FRAMES) {
                let phase = (2.0 * PI * frequency * index as f32) / sample_rate;
                let sample = (phase.sin() * 28000.0) as i16;
                INPUT[index * 2] = sample;
                INPUT[(index * 2) + 1] = sample;
            }
        }
    }

    fn strongest_band() -> (usize, f32) {
        unsafe {
            let mut strongest = (0, BANDS[0]);
            for band_index in 1..MAX_BANDS {
                if BANDS[band_index] > strongest.1 {
                    strongest = (band_index, BANDS[band_index]);
                }
            }
            strongest
        }
    }

    #[test]
    fn render_lissajous_keeps_output_length() {
        write_sine_wave(220.0, 7350.0, 128);

        let rendered = render_lissajous(128, 320.0, 400.0, 0.8, 0.25);

        assert_eq!(rendered, 128);
    }

    #[test]
    fn render_lissajous_applies_scale_to_radius() {
        unsafe {
            INPUT[0] = 16384;
            INPUT[1] = 0;
        }

        render_lissajous(1, 200.0, 200.0, 1.0, 1.0);
        let full_scale_offset = unsafe { OUTPUT[0] - 100.0 };

        render_lissajous(1, 200.0, 200.0, 1.0, 0.25);
        let quarter_scale_offset = unsafe { OUTPUT[0] - 100.0 };

        assert!(full_scale_offset > 0.0);
        assert!((quarter_scale_offset / full_scale_offset - 0.25).abs() < 0.01);
    }

    #[test]
    fn render_equalizer_moves_peak_with_frequency() {
        write_sine_wave(220.0, 7350.0, 256);
        let low_count = render_equalizer(256, 44100.0, 6.0);
        let low_peak = strongest_band();

        write_sine_wave(1800.0, 7350.0, 256);
        let high_count = render_equalizer(256, 44100.0, 6.0);
        let high_peak = strongest_band();

        assert_eq!(low_count, MAX_BANDS);
        assert_eq!(high_count, MAX_BANDS);
        assert!(low_peak.1 > 0.05);
        assert!(high_peak.1 > 0.05);
        assert!(high_peak.0 > low_peak.0);
    }
}
