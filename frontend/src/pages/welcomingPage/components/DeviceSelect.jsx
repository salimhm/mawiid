import { optionArrowIcon } from '../../../assets/icons'

export default function DeviceSelect({ icon, placeholder, value, onChange, disabled, deviceList }) {
    return (
        <div className='relative inline-block w-[160px] sm:w-[186px]'>
            <div className='absolute left-2.5 top-0 h-full flex items-center pointer-events-none text-white text-base sm:text-lg'>
                {icon}
            </div>
            <select
                value={value || ''}
                onChange={onChange}
                disabled={disabled}
                className='text-white border border-white/50 hover:border-white rounded-full w-full h-[36px] appearance-none focus:ring-1 focus:ring-blue-500 focus:outline-none pl-8 sm:pl-9 pr-8 text-xs sm:text-sm bg-black/40 backdrop-blur-md disabled:opacity-40 disabled:cursor-not-allowed transition truncate'
            >
                <option value='' disabled className='bg-black text-white'>{placeholder}</option>
                {deviceList.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId} className='bg-black text-white'>
                        {device.label || `Device ${index + 1}`}
                    </option>
                ))}
            </select>
            <div className='absolute inset-0 h-[36px] right-7 border-r border-white/30 pointer-events-none'></div>
            <div className='absolute right-2 top-0 h-full flex items-center pointer-events-none text-white'>
                {optionArrowIcon()}
            </div>
        </div>
    )
}
