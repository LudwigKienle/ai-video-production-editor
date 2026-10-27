import React from 'react';
import MediaImportPage from './media-pro/MediaImportPage';
import type { MediaImportPageProps } from './media-pro/MediaImportPage';

/**
 * Media page — an import browser: places on the left (recent, favourites,
 * local folders, the app's library and project bins), a thumbnail browser in
 * the centre, import settings and a preview on the right, and a selection
 * tray with the Import button at the bottom. The classic media bin (smart
 * bins, library tab) stays reachable from the places column.
 */
export type ImportWorkspaceProps = MediaImportPageProps;

const ImportWorkspace: React.FC<ImportWorkspaceProps> = (props) => <MediaImportPage {...props} />;

export default ImportWorkspace;
