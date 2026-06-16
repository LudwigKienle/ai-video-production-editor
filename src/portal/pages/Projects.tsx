import React from 'react';
import { fetchProjects, fetchTeams, Project, Team } from '../services/dataService';

export const Projects: React.FC = () => {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    Promise.all([fetchProjects(), fetchTeams()]).then(([projectData, teamData]) => {
      setProjects(projectData);
      setTeams(teamData);
      setLoading(false);
    });
  }, []);

  return (
    <div className="panel">
      <h2>Projects</h2>
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading projects...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Team</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(project => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{project.status}</td>
                <td>{teams.find(team => team.id === project.team_id)?.name || '—'}</td>
                <td>
                  <a className="button secondary" href={`#/projects/${project.id}`}>
                    Open
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
