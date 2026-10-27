// export default function LanguageOptions() {
//     return (
//         <div className="h-[92px] w-[118px]">

//         </div>
//     )
// }

import { useState } from "react";
import { LanguageIcon } from "../utils/icons";


export default function LanguageSelector( {children}) {
  const languages = ["English", "Arabic", "French"];
  const [selected, setSelected] = useState(children); // default selected

  return (
    <div className="w-[118px] h-[97px] rounded-xl overflow-hidden shadow-lg border border-primary-white/20">
      {/* Header */}
      <div className="bg-gray-400 text-gray-800 py-1 text-[11px] font-inter font-[500] flex items-center justify-center gap-1">
        <LanguageIcon />
        Your language
      </div>

      {/* Options */}
      {languages.map((lang) => (
        <div
          key={lang}
          className={` flex justify-center items-center text-[9px] font-inter font-[400] py-1 transition-colors duration-200 border-t border-primary-white/20 
            ${selected === lang ? "bg-secondary-red_accent text-primary-white " : "bg-[#FFFFFF1A] text-primary-white"}`}
        >
          {lang}
        </div>
      ))}
    </div>
  );
}