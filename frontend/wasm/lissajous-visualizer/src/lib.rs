const MAX_FRAMES: usize = 512;

static mut INPUT: [i16; MAX_FRAMES * 2] = [0; MAX_FRAMES * 2];
static mut OUTPUT: [f32; MAX_FRAMES * 2] = [0.0; MAX_FRAMES * 2];

#[no_mangle]
pub extern "C" fn max_frames() -> usize {
    MAX_FRAMES
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
pub extern "C" fn render_lissajous(frame_count: usize, width: f32, height: f32, gain: f32) -> usize {
    let safe_frame_count = frame_count.min(MAX_FRAMES);
    let center_x = width * 0.5;
    let center_y = height * 0.5;
    let clamped_gain = gain.clamp(0.28, 1.24);
    let radius = width.min(height) * 0.34 * clamped_gain;

    unsafe {
        for index in 0..safe_frame_count {
            let left = INPUT[index * 2] as f32 / 32768.0;
            let right = INPUT[(index * 2) + 1] as f32 / 32768.0;

            OUTPUT[index * 2] = center_x + (left * radius);
            OUTPUT[(index * 2) + 1] = center_y - (right * radius);
        }
    }

    safe_frame_count
}