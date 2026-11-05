import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createPlaceholder,
  getAppInvitePreview,
  getClaimPreview,
  issueAppInvite,
  listInvitedPlayers,
  reissueClaimLink,
  revokeClaimLink,
} from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { PlaceholderClaimLink } from '@/api/types';
import { userKeys } from '@/features/users/queries';

import { forgetClaimLink, rememberAppInvite, rememberClaimLink } from './issued-links';

export const inviteKeys = {
  invitedPlayers: (ownerId: string) => ['invited-players', ownerId] as const,
  claimPreview: (token: string) => ['invites', 'claim', token] as const,
  appPreview: (token: string) => ['invites', 'app', token] as const,
};

/** Unusable capability links answer 404; retrying them only delays the error screen. */
const retryUnlessNotFound = (failureCount: number, error: Error) =>
  !(error instanceof ApiError && error.status === 404) && failureCount < 1;

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useClaimPreview(token: string) {
  return useQuery({
    queryKey: inviteKeys.claimPreview(token),
    queryFn: () => getClaimPreview(token),
    retry: retryUnlessNotFound,
    staleTime: 0,
  });
}

export function useAppInvitePreview(token: string) {
  return useQuery({
    queryKey: inviteKeys.appPreview(token),
    queryFn: () => getAppInvitePreview(token),
    retry: retryUnlessNotFound,
    staleTime: 0,
  });
}

export function useInvitedPlayers(ownerId: string | undefined) {
  return useQuery({
    queryKey: inviteKeys.invitedPlayers(ownerId ?? ''),
    queryFn: listInvitedPlayers,
    enabled: !!ownerId,
  });
}

function rememberIssued(ownerId: string, issued: PlaceholderClaimLink) {
  rememberClaimLink(ownerId, issued.user.id, {
    url: issued.claimUrl,
    expiresAt: issued.claimExpiresAt,
  });
}

/** "Add player by name": creates a placeholder and keeps its one-time claim link on this device. */
export function useCreatePlaceholder(ownerId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => createPlaceholder({ displayName }),
    onSuccess: (issued) => {
      if (ownerId) rememberIssued(ownerId, issued);
      void queryClient.invalidateQueries({ queryKey: inviteKeys.invitedPlayers(ownerId ?? '') });
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
}

export function useReissueClaimLink(ownerId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (placeholderId: string) => reissueClaimLink(placeholderId),
    onSuccess: async (issued) => {
      if (ownerId) rememberIssued(ownerId, issued);
      await queryClient.invalidateQueries({ queryKey: inviteKeys.invitedPlayers(ownerId ?? '') });
    },
  });
}

export function useRevokeClaimLink(ownerId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (placeholderId: string) => revokeClaimLink(placeholderId),
    onSuccess: async (_data, placeholderId) => {
      if (ownerId) forgetClaimLink(ownerId, placeholderId);
      await queryClient.invalidateQueries({ queryKey: inviteKeys.invitedPlayers(ownerId ?? '') });
    },
  });
}

/** Issues the reusable app invitation; issuing again rotates it and kills the previous URL. */
export function useIssueAppInvite(ownerId: string | undefined) {
  return useMutation({
    mutationFn: issueAppInvite,
    onSuccess: ({ url }) => {
      if (ownerId) rememberAppInvite(ownerId, url);
    },
  });
}
