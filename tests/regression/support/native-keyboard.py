import ctypes
import ctypes.util
import sys
import time

# Send actual X11 key events to the focused native file chooser in the test's
# isolated display. Browser keyboard events cannot reach GTK dialogs.
x11 = ctypes.CDLL(ctypes.util.find_library('X11'))
xtest = ctypes.CDLL(ctypes.util.find_library('Xtst'))
x11.XOpenDisplay.restype = ctypes.c_void_p
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError('Native file chooser tests require an X11 display.')
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtest.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

def key(name, pressed):
    code = x11.XKeysymToKeycode(display, x11.XStringToKeysym(name.encode()))
    if not code:
        raise RuntimeError('Unsupported test key: ' + name)
    xtest.XTestFakeKeyEvent(display, code, pressed, 0)
    x11.XFlush(display)

try:
    if sys.argv[1].startswith('.'):
        key('Home', 1)
        key('Home', 0)
    else:
        for char in sys.argv[1]:
            if char == '_':
                key('Shift_L', 1)
            name = 'underscore' if char == '_' else ('period' if char == '.' else char)
            key(name, 1)
            key(name, 0)
            if char == '_':
                key('Shift_L', 0)
            time.sleep(0.04)
        time.sleep(0.3)
        key('Escape', 1)
        key('Escape', 0)
        time.sleep(0.15)
    key('Return', 1)
    key('Return', 0)
finally:
    x11.XCloseDisplay(display)
