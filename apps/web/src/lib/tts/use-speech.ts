"use client"

import { useEffect, useState, useCallback } from "react"
import { speaker, type SpeakerStatus, type PlayOptions } from "./speaker"

export function useSpeech() {
  const [status, setStatus] = useState<SpeakerStatus>(() => speaker.getStatus())

  useEffect(() => {
    return speaker.subscribe(setStatus)
  }, [])

  const isPlaying = status.state === "playing"
  const isPreparing = status.state === "preparing"

  const isCurrent = useCallback(
    (messageId: string) => status.messageId === messageId,
    [status.messageId],
  )

  const isMessagePlaying = useCallback(
    (messageId: string) => status.messageId === messageId && status.state === "playing",
    [status.messageId, status.state],
  )

  const isMessageBusy = useCallback(
    (messageId: string) =>
      status.messageId === messageId &&
      (status.state === "playing" || status.state === "preparing" || status.state === "paused"),
    [status.messageId, status.state],
  )

  const play = useCallback((messageId: string, text: string, options?: PlayOptions) => {
    return speaker.play(messageId, text, options)
  }, [])

  const stop = useCallback(() => {
    speaker.stop()
  }, [])

  const pause = useCallback(() => {
    speaker.pause()
  }, [])

  const resume = useCallback(() => {
    speaker.resume()
  }, [])

  const toggle = useCallback(
    (messageId: string, text: string, options?: PlayOptions) => {
      if (
        status.messageId === messageId &&
        (status.state === "playing" || status.state === "preparing")
      ) {
        speaker.stop()
      } else {
        void speaker.play(messageId, text, options)
      }
    },
    [status.messageId, status.state],
  )

  return {
    status,
    isPlaying,
    isPreparing,
    isCurrent,
    isMessagePlaying,
    isMessageBusy,
    play,
    stop,
    pause,
    resume,
    toggle,
  }
}
