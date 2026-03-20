import { useEffect, useRef } from 'react'

export function AddLinksModal(props: {
  isOpen: boolean
  isSubmitting: boolean
  message?: {
    tone: 'neutral' | 'error'
    text: string
  } | null
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!props.isOpen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [props.isOpen])

  useEffect(() => {
    if (!props.isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !props.isSubmitting) {
        props.onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [props.isOpen, props.isSubmitting, props.onClose])

  if (!props.isOpen) {
    return null
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !props.isSubmitting) {
          props.onClose()
        }
      }}
    >
      <div
        aria-labelledby="add-links-title"
        aria-modal="true"
        className="modal panel stack-md"
        role="dialog"
      >
        <div className="modal__header stack-sm">
          <p className="eyebrow">Add Links</p>
          <h2 className="section-title" id="add-links-title">
            Paste links and let AI file them automatically.
          </h2>
          <p className="muted">
            Add one URL per line or paste a comma-separated batch. New links will
            be analyzed and routed into boards for you.
          </p>
        </div>

        <textarea
          className="input input-textarea modal__textarea"
          disabled={props.isSubmitting}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={'https://example.com/inspiration\nhttps://x.com/...'}
          ref={textareaRef}
          rows={7}
          value={props.value}
        />

        {props.message ? (
          <p
            className={
              props.message.tone === 'error'
                ? 'form-note form-note--error'
                : 'form-note'
            }
          >
            {props.message.text}
          </p>
        ) : null}

        <div className="modal__actions row gap-sm">
          <button
            className="button button-secondary"
            disabled={props.isSubmitting}
            onClick={props.onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={props.isSubmitting}
            onClick={props.onSubmit}
            type="button"
          >
            {props.isSubmitting ? 'Saving and routing...' : 'Save Links'}
          </button>
        </div>
      </div>
    </div>
  )
}
