import {ArrowIcon} from "../utils/icons";
import { useEffect, useRef, useState } from "react";



export default function WordScroller() {
  const words = [
    "Life", "Journey", "English", "French", "Worldwide",
    "Transcript", "Language", "Meeting", "Video", "Future", "Communication",
  ];

  const loopWords = [...words, ...words, ...words, ...words, ...words]; 
  const [index, setIndex] = useState(words.length);
  const [animate, setAnimate] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth < 1024;

  const itemHeight = isMobile ? 70 : isTablet ? 110 : 200;
  const viewportHeight = isMobile ? 420 : isTablet ? 650 : 1200;
  const arrowWidth = isMobile ? 32 : isTablet ? 45 : 62;
  const arrowGap = isMobile ? 12 : isTablet ? 30 : 60;
  const wordTrackWidth = isMobile ? 220 : isTablet ? 380 : 650;
  const trackWidth = arrowWidth + wordTrackWidth + arrowGap;
  const fontSize = isMobile ? 32 : isTablet ? 50 : 80;
  const arcStrength = isMobile ? 10 : isTablet ? 22 : 38;

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => {
        if (prev >= words.length * 3) { 
          setAnimate(false);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setAnimate(true)); 
          });
          return words.length; 
        }
        return prev + 1;
      });
    }, 800);
    return () => clearInterval(interval);
  }, [words.length]);

  const translateY = viewportHeight / 2 - itemHeight / 2 - index * itemHeight;

  return (
    <div
      className="relative mx-auto w-full max-w-[930px] lg:ml-[-60px] overflow-hidden bg-black flex justify-center"
      style={{ height: viewportHeight }}
    >
      <div className="relative h-full" style={{ width: trackWidth }}>
        <span
          className="pointer-events-none absolute left-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-end text-xl sm:text-2xl font-medium text-primary-white select-none"
          style={{ height: itemHeight, width: arrowWidth }}
        >
          <span key={index} className="transform scale-75 sm:scale-100">
            {ArrowIcon()}
          </span>
        </span>

        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: wordTrackWidth,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            transform: `translateY(${translateY}px)`,
            willChange: "transform",
            transition: animate ? "transform 300ms ease-out" : "none", 
          }}
        >
          {loopWords.map((word, i) => {
            const distance = i - index;
            const absDistance = Math.abs(distance);
            const offsetX = -(1 - Math.cos((distance / words.length) * Math.PI)) * arcStrength * words.length;
            const blur = absDistance * (isMobile ? 3 : 5.5);
            const opacity = absDistance === 0 ? 1 : Math.max(0.0, 1 - absDistance * 0.25);
            const isSelected = i % words.length === index % words.length;
            const maxRotation = 0;     
            const rotationStep = isMobile ? -5 : -10;
            const rotate = maxRotation - distance * rotationStep;

            return (
              <div
                key={`${word}-${i}`}
                className="flex w-full shrink-0 items-center justify-start"
                style={{
                  height: itemHeight,
                  filter: `blur(${blur}px)`,
                  opacity,
                  transform: `translateX(${offsetX}px) rotate(${rotate}deg)`,
                  transition: animate ? "all 300ms ease-out" : "none", 
                }}
              >
                <span
                  className={`font-montserrat w-full select-none text-start font-bold ${
                    isSelected ? "gradient-text flex animate-slide" : "text-gray-500 flex"
                  }`}
                  style={{ fontSize }}
                >
                  {word}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}