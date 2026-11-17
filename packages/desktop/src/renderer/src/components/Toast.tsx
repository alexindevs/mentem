import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

export interface ToastMessage {
  text: string;
  action?: { label: string; run(): void };
}

/** A short message at the bottom of the window that clears itself. */
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone(): void }) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 8000);
    return () => window.clearTimeout(id);
  }, [message, onDone]);
  return (
    <AnimatePresence>
      {message && (
        <div className="toast-wrap"><motion.div className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
          <span>{message.text}</span>
          {message.action && (
            <button
              onClick={() => {
                message.action?.run();
                onDone();
              }}
            >
              {message.action.label}
            </button>
          )}
        </motion.div></div>
      )}
    </AnimatePresence>
  );
}
