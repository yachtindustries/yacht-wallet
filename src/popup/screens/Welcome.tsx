import { Link } from 'react-router-dom';

const logoUrl = chrome.runtime.getURL('yacht-icon.png');

export default function Welcome() {
  return (
    <div
      className="flex flex-col h-full px-6 py-5"
      style={{ backgroundColor: '#002849' }}
    >
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-white">Yacht</h1>
      </div>

      <div className="flex-1 flex flex-col items-center" style={{ paddingTop: '10%' }}>
        <img src={logoUrl} alt="Yacht" className="object-contain" style={{ width: 250, height: 250 }} />
      </div>

      <div className="flex flex-col items-center gap-2 mb-[10%]">
        <Link
          to="/create"
          className="w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold text-white bg-[#5eccfa] hover:bg-[#3eb8e8]"
          style={{ fontSize: 17 }}
        >
          Create wallet
        </Link>
        <Link
          to="/import"
          className="w-full max-w-xs rounded-xl px-3 py-3 text-center font-bold text-black bg-white"
          style={{ fontSize: 17 }}
        >
          Import wallet
        </Link>
      </div>
    </div>
  );
}
