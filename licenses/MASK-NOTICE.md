# Merchant-logo mask attribution

`src/app/modules/banking/merchant-logos/merchant-logo-mask.ts` translates the RGB-average alpha, min/max expansion and contrast pass in AOSP's Android 16 QPR2 `MonochromeIconFactory.generateMono()` to TypeScript.

Copyright (C) 2024 The Android Open Source Project. Licensed under the Apache License, Version 2.0; see [APACHE-2.0.txt](APACHE-2.0.txt).

Source: https://android.googlesource.com/platform/frameworks/libs/systemui/+/refs/heads/android16-qpr2-release/iconloaderlib/src/com/android/launcher3/icons/MonochromeIconFactory.java

Tempo's changes are an opaque-bitmap adapter (dominant visible field, continuous colour-key matte, foreground polarity, guarded compact-palette tonal lift and enclosed-detail protection), plus 104px mark placement on a 128px canvas. These additions are not Android launcher behavior and do not reconstruct authored monochrome artwork. The contrast core is unchanged.

`mask-resample.ts` translates the 8-bit LANCZOS coefficient calculation and separable resampling from Pillow 12.3.0's `src/libImaging/Resample.c`. It retains the quantized coefficients, pass order and intermediate-byte rounding needed to preserve the reference pixels. See [PILLOW.txt](PILLOW.txt) for its copyright, MIT-CMU permission and warranty notices.

Source: https://github.com/python-pillow/Pillow/blob/12.3.0/src/libImaging/Resample.c

No Pillow or Python runtime is used. Sharp decodes the cached source and encodes the white RGBA alpha mask. Source artwork is not included or modified.
