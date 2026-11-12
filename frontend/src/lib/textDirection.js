const RTL_LETTERS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g
const LTR_LETTERS = /[A-Za-zÀ-ɏ]/g

// 'rtl' when most of the letters are Arabic (or Hebrew), 'ltr' when most are Latin,
// '' when neither wins (no letters, e.g. only numbers or Chinese).
export function textDirection(text) {
    const rtl = (text.match(RTL_LETTERS) || []).length
    const ltr = (text.match(LTR_LETTERS) || []).length
    if (rtl === ltr)
        return ''
    return rtl > ltr ? 'rtl' : 'ltr'
}
