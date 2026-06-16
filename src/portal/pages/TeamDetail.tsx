import React from 'react';
import { fetchTeamById, Team } from '../services/dataService';

type TeamDetailProps = {
  teamId: string;
};

export const TeamDetail: React.FC<TeamDetailProps> = ({ teamId }) => {
  const [team, setTeam] = React.useState<Team | null>(null);

  React.useEffect(() => {
    fetchTeamById(teamId).then(setTeam);
  }, [teamId]);

  if (!team) {
    return <div className="panel">Loading team...</div>;
  }

  return (
    <div className="panel">
      <h2>{team.name}</h2>
      <p style={{ margin: 0, color: 'var(--muted)' }}>Seats: {team.seats}</p>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Invite member</h2>
        <div className="field">
          <label>Email</label>
          <input placeholder="new@client.com" />
        </div>
        <div className="button-row">
          <button className="button primary">Send Invite</button>
          <span className="status">Invites require backend hookup.</span>
        </div>
      </div>
    </div>
  );
};
