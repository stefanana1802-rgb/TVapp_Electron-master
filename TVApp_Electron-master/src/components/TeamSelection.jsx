import React, { useEffect, useState } from 'react';
import AumovioLogo from './AumovioLogo.jsx';

/**
 * Ecran de alegere a echipei (prima deschidere sau după "Schimbă echipa").
 * Listează directoarele din WORKSPACE și salvează selecția.
 */
function TeamSelection({ onSelect }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!window.api?.getTeams) {
      setError('Not running in Electron.');
      setLoading(false);
      return;
    }
    window.api.getTeams().then((list) => {
      setTeams(list || []);
      setLoading(false);
    }).catch((err) => {
      setError(err?.message || 'Failed to load departments');
      setLoading(false);
    });
  }, []);

  const handleSelect = async (team) => {
    if (!window.api?.setSelectedTeam) return;
    try {
      await window.api.setSelectedTeam(team);
      onSelect(team);
    } catch (e) {
      setError(e?.message || 'Failed to save department');
    }
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-background text-gray-600">
        <p className="text-xl">Loading departments…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-background text-gray-700 px-8">
        <h1 className="text-2xl font-semibold mb-4 text-gray-900">Error</h1>
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-background px-8">
      <AumovioLogo className="h-10 w-auto mb-8" textColor="#111827" />
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Select department</h1>
      <p className="text-sm text-gray-500 mb-8">
        Choose the department for this TV. Content will load from <span className="font-mono">WORKSPACE/&lt;department&gt;/</span>.
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        {teams.length === 0 ? (
          <p className="text-gray-500">No departments found. Add folders in <span className="font-mono">WORKSPACE/</span> (e.g. SAM, CAIRs, ESB).</p>
        ) : (
          teams.map((team) => (
            <button
              key={team}
              type="button"
              onClick={() => handleSelect(team)}
              className="px-8 py-4 rounded-2xl bg-surface border border-gray-200 shadow-sm text-gray-900 font-medium hover:border-accent hover:ring-2 hover:ring-accent/20 transition"
            >
              {team}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default TeamSelection;
