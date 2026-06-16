import React from 'react';
import { fetchTeams, Team } from '../services/dataService';

export const Teams: React.FC = () => {
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchTeams().then((data) => {
      setTeams(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="panel">
      <h2>Teams</h2>
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading teams...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Seats</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(team => (
              <tr key={team.id}>
                <td>{team.name}</td>
                <td>{team.seats}</td>
                <td>
                  <a className="button secondary" href={`#/teams/${team.id}`}>
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
