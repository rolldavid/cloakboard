'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAztecStore } from '@/store/aztecStore';
import type { GroupedCloaks, DashboardStats, DashboardCloak } from '../core/DashboardService';
import { MembershipType } from '../core/RegistryService';
import { getTemplateMetadata } from '../constants/templates';

/**
 * Dashboard state
 */
export interface DashboardState {
  isLoading: boolean;
  error: string | null;
  groupedCloaks: GroupedCloaks;
  stats: DashboardStats;
  selectedSection: 'all' | 'created' | 'admin' | 'member' | 'starred';
}

/**
 * Dashboard filter options
 */
export interface DashboardFilters {
  templateId?: number;
  privacyLevel?: 'maximum' | 'balanced' | 'transparent';
  searchQuery?: string;
}

/**
 * Hook for managing dashboard state
 */
export function useDashboard() {
  const fullCloakList = useAztecStore((state: any) => state.cloakList);
  const account = useAztecStore((state: any) => state.account);
  const addCloak = useAztecStore((state: any) => state.addCloak);
  const removeCloak = useAztecStore((state: any) => state.removeCloak);
  const starredAddresses = useAztecStore((state: any) => state.starredAddresses);
  const addStarredAddress = useAztecStore((state: any) => state.addStarredAddress);
  const removeStarredAddress = useAztecStore((state: any) => state.removeStarredAddress);

  // All cloaks in the store belong to the current user (fetched from CloakMemberships)
  const cloakList = fullCloakList;

  const [state, setState] = useState<DashboardState>({
    isLoading: false,
    error: null,
    groupedCloaks: {
      created: [],
      admin: [],
      member: [],
    },
    stats: {
      totalCloaks: 0,
      createdCloaks: 0,
      adminCloaks: 0,
      memberCloaks: 0,
      totalVotingPower: 0n,
    },
    selectedSection: 'all',
  });

  const [filters, setFilters] = useState<DashboardFilters>({});

  /**
   * Convert store Cloaks to dashboard format
   * In production, this would fetch from DashboardService
   */
  const loadDashboard = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // For MVP, we categorize Cloaks from local storage
      // In production, this would use DashboardService.enrichCloakList()
      const groupedCloaks: GroupedCloaks = {
        created: [],
        admin: [],
        member: [],
      };

      // Convert store format to dashboard format and group by role
      for (const cloak of cloakList) {
        const tplId = cloak.templateId ?? 1;
        const tplMeta = getTemplateMetadata(tplId as any);
        const role = cloak.role ?? 0;

        // Map role to MembershipType
        let membershipType = MembershipType.Creator;
        if (role === 2) membershipType = MembershipType.Admin;
        else if (role === 1) membershipType = MembershipType.Member;

        const dashboardCloak: DashboardCloak = {
          address: cloak.address,
          nameHash: '',
          templateId: tplId,
          createdAt: cloak.lastActivityAt ?? 0,
          isActive: true,
          creator: '',
          memberCount: cloak.memberCount,
          membershipType,
          templateName: tplMeta?.name ?? 'Unknown',
          privacyLevel: cloak.privacyLevel ?? tplMeta?.defaultPrivacy ?? 'balanced',
          recentActivity: {
            proposalCount: cloak.proposalCount,
            lastActivityAt: cloak.lastActivityAt ?? Date.now(),
          },
        };

        // Group by role: 3=created, 2=admin, 1=member
        if (role === 3) {
          groupedCloaks.created.push(dashboardCloak);
        } else if (role === 2) {
          groupedCloaks.admin.push(dashboardCloak);
        } else {
          groupedCloaks.member.push(dashboardCloak);
        }
      }

      const stats: DashboardStats = {
        totalCloaks: cloakList.length,
        createdCloaks: groupedCloaks.created.length,
        adminCloaks: groupedCloaks.admin.length,
        memberCloaks: groupedCloaks.member.length,
        totalVotingPower: 0n,
      };

      setState((prev) => ({
        ...prev,
        isLoading: false,
        groupedCloaks,
        stats,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load dashboard';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, [cloakList]);

  /**
   * Refresh dashboard data
   */
  const refresh = useCallback(() => {
    loadDashboard();
  }, [loadDashboard]);

  /**
   * Set selected section
   */
  const setSection = useCallback((section: DashboardState['selectedSection']) => {
    setState((prev) => ({ ...prev, selectedSection: section }));
  }, []);

  /**
   * Get filtered Cloaks based on current section and filters
   */
  const getFilteredCloaks = useCallback((): DashboardCloak[] => {
    let cloaks: DashboardCloak[] = [];

    switch (state.selectedSection) {
      case 'created':
        cloaks = state.groupedCloaks.created;
        break;
      case 'admin':
        cloaks = state.groupedCloaks.admin;
        break;
      case 'member':
        cloaks = state.groupedCloaks.member;
        break;
      case 'starred':
        // Get all cloaks and filter by starred addresses
        cloaks = [
          ...state.groupedCloaks.created,
          ...state.groupedCloaks.admin,
          ...state.groupedCloaks.member,
        ].filter((cloak) => starredAddresses.includes(cloak.address));
        break;
      case 'all':
      default:
        cloaks = [
          ...state.groupedCloaks.created,
          ...state.groupedCloaks.admin,
          ...state.groupedCloaks.member,
        ];
    }

    // Apply filters
    if (filters.templateId !== undefined) {
      cloaks = cloaks.filter((d: any) => d.templateId === filters.templateId);
    }

    if (filters.privacyLevel) {
      cloaks = cloaks.filter((d: any) => d.privacyLevel === filters.privacyLevel);
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      cloaks = cloaks.filter((d) => {
        // Look up the cloak name from the store
        const storeEntry = cloakList.find((c: any) => c.address === d.address);
        const name = storeEntry?.name ?? '';
        return (
          name.toLowerCase().includes(query) ||
          d.address.toLowerCase().includes(query) ||
          d.templateName.toLowerCase().includes(query)
        );
      });
    }

    return cloaks;
  }, [state.selectedSection, state.groupedCloaks, filters, starredAddresses]);

  /**
   * Add a new Cloak to local storage
   */
  const trackCloak = useCallback(
    (cloak: { address: string; name: string; memberCount: number; proposalCount: number }) => {
      addCloak(cloak);
    },
    [addCloak]
  );

  /**
   * Remove a Cloak from local storage
   */
  const untrackCloak = useCallback(
    (address: string) => {
      removeCloak(address);
    },
    [removeCloak]
  );

  /**
   * Check if a cloak is starred
   */
  const isStarred = useCallback(
    (address: string): boolean => {
      return starredAddresses.includes(address);
    },
    [starredAddresses]
  );

  /**
   * Toggle star status for a cloak
   * This updates the local cache immediately - the actual on-chain
   * operation should be handled by the caller using StarredCloaksService
   */
  const toggleStar = useCallback(
    (address: string) => {
      if (starredAddresses.includes(address)) {
        removeStarredAddress(address);
      } else {
        addStarredAddress(address);
      }
    },
    [starredAddresses, addStarredAddress, removeStarredAddress]
  );

  // Load dashboard on mount and when cloakList changes
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return {
    ...state,
    filters,
    setFilters,
    setSection,
    getFilteredCloaks,
    refresh,
    trackCloak,
    untrackCloak,
    // Starred cloaks
    starredAddresses,
    isStarred,
    toggleStar,
  };
}
