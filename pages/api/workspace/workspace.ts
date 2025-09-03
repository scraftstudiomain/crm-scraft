import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabaseServer"; // Import the Supabase client
import { AUTH_MESSAGES } from "@/lib/constant/auth";
import { ActivityLogger } from "@/lib/services/activityLogger";
import { ActivityType } from "@/lib/types/activity-logs";
import { logger } from "@/lib/logger";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body, query, headers } = req;
  const action = query.action as string;
  switch (method) {
    case "POST": {
      if (!method) {
        return res.status(400).json({ error: AUTH_MESSAGES.SIGNUP_FAILED });
      }
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
      }
      const token = authHeader.split(" ")[1];
      switch (action) {
        case "createWorkspace": {
          const {
            name,
            status,
            companyType,
            companySize,
            industry,
            timezone,
            currency,
            notifications,
          } = body;

          const {
            data: { user },
          } = await supabase.auth.getUser(token);
          if (!user) {
            return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
          }

          if (!name || !status || !companyType || !companySize || !industry) {
            return res.status(400).json({ error: "Missing required fields" });
          }

          try {
            // First create the workspace and get its ID
            const { data: workspaceData, error: workspaceError } =
              await supabase
                .from("workspaces")
                .insert([
                  {
                    name,
                    status,
                    company_type: companyType,
                    company_size: companySize,
                    industry,
                    timezone: timezone || 'UTC',
                    currency: currency || 'INR',
                    notifications,
                    owner_id: user?.id,
                  },
                ])
                .select(); // Add .select() to return the inserted data

            if (workspaceError) {
              return res.status(500).json({ error: workspaceError.message });
            }

            // Now create the workspace member entry using the new workspace's ID
            const { error: memberError } = await supabase
              .from("workspace_members")
              .insert({
                role: "SuperAdmin",
                added_by: user?.id,
                email: user?.email,
                status: "accepted",
                user_id: user?.id,
                workspace_id: workspaceData[0].id,
              });

            if (memberError) {
              // If member creation fails, you might want to rollback the workspace creation
              // or handle the error appropriately
              return res.status(500).json({ error: memberError.message });
            }

            // Log workspace creation activity
            try {
              await ActivityLogger.logActivity({
                workspace_id: workspaceData[0].id.toString(),
                user_id: user.id,
                member_email: user.email || '',
                member_name: user.user_metadata?.name || user.user_metadata?.firstName,
                activity_type: 'workspace_created' as any,
                activity_description: `Workspace "${name}" created by ${user.email}`,
                metadata: {
                  workspace_name: name,
                  resource_type: 'workspace',
                  resource_id: workspaceData[0].id,
                  additional_info: {
                    company_type: companyType,
                    company_size: companySize,
                  },
                },
                ip_address: ActivityLogger.getClientIP(req),
                user_agent: ActivityLogger.getUserAgent(req),
              });
            } catch (logError) {
              console.error('Failed to log workspace creation activity:', logError);
            }

            return res.status(201).json({
              message: "Workspace and member created",
              data: workspaceData[0],
            });
          } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "An error occurred" });
          }
        }
        default:
          return res.status(400).json({ error: "Invalid action" });
      }
    }
    case "GET": {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
      }
      const token = authHeader.split(" ")[1];

      switch (action) {
        case "getWorkspaces": {
          const {
            data: { user },
          } = await supabase.auth.getUser(token);

          if (!user) {
            return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
          }

          try {
            const { data: ownedWorkspaces, error: ownedError } = await supabase
              .from("workspaces")
              .select("*")
              .eq("owner_id", user.id);

            if (ownedError) {
              return res.status(500).json({ error: ownedError.message });
            }

            const { data: memberWorkspaces, error: memberError } =
              await supabase
                .from("workspace_members")
                .select("workspace_id")
                .eq("email", user.email);

            if (memberError) {
              return res.status(500).json({ error: memberError.message });
            }
            const workspaceIds: any = [
              ...new Set([
                ...ownedWorkspaces.map((ws) => ws.id),
                ...memberWorkspaces.map((ws) => ws.workspace_id),
              ]),
            ].filter((id) => id !== null && id !== undefined);

            const { data: allWorkspaces, error: allWorkspacesError } =
              await supabase
                .from("workspaces")
                .select("*")
                .in("id", workspaceIds);

            if (allWorkspacesError) {
              return res
                .status(500)
                .json({ error: allWorkspacesError.message });
            }
            return res
              .status(200)
              .json({ message: "Workspaces fetched", data: allWorkspaces });
          } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "An error occurred" });
          }
        }
        case "getLeadsRevenueByWorkspace": {
          const workspaceId = query.workspaceId as string;
          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }
          try {
            const { data, error } = await supabase.rpc(
              "calculate_total_revenue",
              {
                workspace_id: workspaceId,
              }
            );
            if (error) {
              console.error("Error calculating revenue:", error);
              return res.status(400).json({ error: error.message });
            }
            return res.status(200).json({ totalRevenue: data });
          } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        case "getWorkspaceMembers": {
          const { workspaceId } = query;
          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          const { data, error } = await supabase
            .from("workspace_members")
            .select()
            .eq("workspace_id", workspaceId)
            // .eq("status", "accepted")
          if (error) {
            return res.status(400).json({ error: error.message });
          }

          return res.status(200).json({ data });
        }

        case "getWorkspacesById": {
          const {
            data: { user },
          } = await supabase.auth.getUser(token);

          if (!user) {
            return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
          }

          const { workspaceId } = req.query;

          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          try {
            const { data: workspace, error: workspaceError } = await supabase
              .from("workspaces")
              .select("*")
              .eq("id", workspaceId)
              .single();

            if (workspaceError) {
              return res.status(500).json({ error: workspaceError.message });
            }

            if (!workspace) {
              return res.status(404).json({ error: "Workspace not found" });
            }

            // Check if the user is the owner
            if (workspace.owner_id === user.id) {
              return res
                .status(200)
                .json({ message: "Workspace fetched", data: workspace });
            }

            // Check if the user is a member
            const { data: membership, error: membershipError } = await supabase
              .from("workspace_members")
              .select("*")
              .eq("workspace_id", workspaceId)
              .eq("user_id", user.id)
              .single(); // Expect only one match

            if (membershipError) {
              return res.status(500).json({ error: membershipError.message });
            }

            if (!membership) {
              return res
                .status(403)
                .json({ error: AUTH_MESSAGES.UNAUTHORIZED });
            }
            // Return workspace data if the user is a member
            return res
              .status(200)
              .json({ message: "Workspace fetched", data: workspace });
          } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "An error occurred" });
          }
        }
        // Update your existing getActiveWorkspace case:
        case "getActiveWorkspace": {
          logger.debug("getActiveWorkspace API called");
          const {
            data: { user },
          } = await supabase.auth.getUser(token);

          if (!user) {
            return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
          }

          logger.debug("getActiveWorkspace: User authenticated:", {
            id: user.id,
            email: user.email
          });

          try {
            // First check if there's already an active workspace
            let { data: activeWorkspace, error: activeError } = await supabase
              .from("workspace_members")
              .select(
                `
        workspace_id,
        role,
        is_active,
        workspaces (*)
      `
              )
              .eq("user_id", user.id)
              .eq("is_active", true)
              .eq("status", "accepted")
              .single();

            // If no active workspace found, set the first available one as active
            if (!activeWorkspace || activeError) {
              logger.debug("getActiveWorkspace: No active workspace found, auto-activating first workspace");
              // Get the first workspace where user is a member
              const { data: firstWorkspace, error: firstError } = await supabase
                .from("workspace_members")
                .select(
                  `
          id,
          workspace_id,
          role,
          workspaces (*)
        `
                )
                .eq("user_id", user.id)
                .eq("status", "accepted")
                .order("created_at", { ascending: true })
                .limit(1)
                .single();

              if (firstError) {
                console.error("Error getting first workspace:", firstError);
                return res
                  .status(404)
                  .json({ error: "No workspaces found for user" });
              }

              if (firstWorkspace) {
                // Deactivate all workspaces first
                await supabase
                  .from("workspace_members")
                  .update({ is_active: false })
                  .eq("user_id", user.id);

                // Set the first workspace as active
                const { error: setActiveError } = await supabase
                  .from("workspace_members")
                  .update({ is_active: true })
                  .eq("id", firstWorkspace.id);

                if (setActiveError) {
                  throw setActiveError;
                }

                // Log workspace login activity for first-time activation
                logger.debug("getActiveWorkspace: First workspace activation, logging activity");
                try {
                  const loginResult = await ActivityLogger.logActivity({
                    workspace_id: firstWorkspace.workspace_id.toString(),
                    user_id: user.id,
                    member_email: user.email || '',
                    member_name: user.user_metadata?.name || user.user_metadata?.firstName,
                    activity_type: 'workspace_join' as any,
                    activity_description: `${user.email} activated their first workspace: ${(firstWorkspace.workspaces as any)?.name || 'Unknown'}`,
                    metadata: {
                      workspace_name: (firstWorkspace.workspaces as any)?.name,
                      additional_info: {
                        activation_type: 'first_workspace',
                        member_role: firstWorkspace.role
                      }
                    },
                    ip_address: ActivityLogger.getClientIP(req),
                    user_agent: ActivityLogger.getUserAgent(req),
                  });
                  logger.debug("getActiveWorkspace: First workspace activation logged:", loginResult);
                } catch (logError) {
                  console.error('getActiveWorkspace: Failed to log workspace activation:', logError);
                  // Don't fail the request if logging fails
                }

                // Return the newly activated workspace
                return res.status(200).json({
                  data: {
                    ...firstWorkspace.workspaces,
                    role: firstWorkspace.role,
                    is_active: true,
                  },
                });
              }

              return res.status(404).json({ error: "No workspaces found" });
            }
            logger.debug("getActiveWorkspace: Found existing active workspace:", activeWorkspace);

            // Check if this is a fresh login (detected by auth state listener)
            const freshLoginHeader = req.headers['x-fresh-login'] === 'true';
            const userAgent = ActivityLogger.getUserAgent(req);
            const isBrowserRequest = userAgent && !userAgent.includes('node-fetch') && !userAgent.includes('axios');
            
            if (freshLoginHeader && isBrowserRequest) {
              // Log login activity only for fresh logins from browser
              logger.debug("getActiveWorkspace: Fresh login detected, logging login activity");
              try {
                const loginResult = await ActivityLogger.logLogin(
                  activeWorkspace.workspace_id.toString(),
                  user.id,
                  user.email || '',
                  user.user_metadata?.name || user.user_metadata?.firstName,
                  ActivityLogger.getClientIP(req),
                  userAgent
                );
                logger.debug("getActiveWorkspace: Login activity logged:", loginResult);
              } catch (logError) {
                console.error('getActiveWorkspace: Failed to log login activity:', logError);
                // Don't fail the request if logging fails
              }
            } else {
              logger.debug("getActiveWorkspace: Not a fresh login, skipping login activity log");
            }

            // Return the existing active workspace
            return res.status(200).json({
              data: {
                ...activeWorkspace.workspaces,
                role: activeWorkspace.role,
                is_active: true,
              },
            });
          } catch (error) {
            console.error("Error getting active workspace:", error);
            return res
              .status(500)
              .json({ error: "Failed to get active workspace" });
          }
        }

        case "getQualifiedLeadsCount": {
          const { workspaceId } = query;

          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          try {
            // First, get all statuses where count_statistics is true
            const { data: qualifiedStatuses, error: statusError } =
              await supabase
                .from("status")
                .select("name")
                .eq("count_statistics", true);

            if (statusError) {
              console.error("Error fetching qualified statuses:", statusError);
              return res.status(400).json({ error: statusError.message });
            }

            // Extract status names that should be counted
            const qualifiedStatusNames = qualifiedStatuses.map(
              (status) => status.name
            );
            logger.debug(qualifiedStatusNames);

            // Count leads that match the qualified status names for the given workspace
            // Using ->> operator to access the name field within the status JSON object
            const { data: leadsCount, error: leadsError } = await supabase
              .from("leads")
              .select("id", { count: "exact" })
              .eq("work_id", workspaceId)
              .filter("status->>name", "in", `(${qualifiedStatusNames})`);
            if (leadsError) {
              console.error("Error counting qualified leads:", leadsError);
              return res.status(400).json({ error: leadsError.message });
            }

            return res.status(200).json({
              qualifiedLeadsCount: leadsCount?.length,
              qualifiedStatuses: qualifiedStatusNames,
            });
          } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        case "getArrivedLeadsCount": {
          const { workspaceId } = query;

          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          // Convert workspaceId to integer
          const workspaceIdInt = parseInt(workspaceId as string);
          if (isNaN(workspaceIdInt)) {
            return res
              .status(400)
              .json({ error: "Invalid workspace ID format" });
          }

          try {
            const { data, error } = await supabase.rpc("count_arrived_leads", {
              workspace_id: workspaceIdInt,
            });

            if (error) {
              console.error("Error counting arrived leads:", error);
              return res.status(400).json({ error: error.message });
            }

            return res.status(200).json({ arrivedLeadsCount: data });
          } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        case "getWorkspaceAnalytics": {
          const { workspaceId } = query;
          const token = authHeader.split(" ")[1];

          // Validate workspace ID presence
          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          // Parse and validate workspace ID format
          const workspaceIdInt = parseInt(workspaceId as string);
          if (isNaN(workspaceIdInt)) {
            return res
              .status(400)
              .json({ error: "Invalid workspace ID format" });
          }

          try {
            // Get user from token
            const {
              data: { user },
              error: userError,
            } = await supabase.auth.getUser(token);

            if (userError) {
              return res.status(401).json({ error: "Unauthorized" });
            }

            // Fetch webhooks for the workspace
            const { data: webhooks, error: webhooksError } = await supabase
              .from("webhooks")
              .select("*")
              .eq("workspace_id", workspaceIdInt);

            if (webhooksError) {
              console.error("Error fetching webhooks:", webhooksError);
              return res
                .status(500)
                .json({ error: "Failed to fetch webhooks" });
            }

            // Get lead counts for each webhook
            const webhookAnalytics = await Promise.all(
              webhooks.map(async (webhook) => {
                // Extract source_id from webhook URL
                const url = new URL(webhook.webhook_url);
                const sourceId = url.searchParams.get("sourceId");

                if (!sourceId) {
                  return {
                    webhook_name: webhook.name,
                    lead_count: 0,
                    webhook_url: webhook.webhook_url,
                  };
                }

                // Fetch leads count for this webhook's source
                const { count, error: leadsError } = await supabase
                  .from("leads")
                  .select("*", { count: "exact", head: true })
                  .eq("work_id", workspaceIdInt)
                  .eq("lead_source_id", sourceId);

                if (leadsError) {
                  console.error(
                    `Error fetching leads for webhook ${webhook.name}:`,
                    leadsError
                  );
                  return {
                    webhook_name: webhook.name,
                    lead_count: 0,
                    webhook_url: webhook.webhook_url,
                    error: "Failed to fetch leads count",
                  };
                }

                return {
                  webhook_name: webhook.name,
                  lead_count: count || 0,
                  webhook_url: webhook.webhook_url,
                };
              })
            );

            return res.status(200).json(webhookAnalytics);
          } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        case "getTotalLeadsCount": {
          const { workspaceId } = query;

          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          // Convert workspaceId to bigint
          const workspaceIdBigInt = BigInt(workspaceId as string);
          logger.debug(workspaceIdBigInt);

          try {
            const { data, error } = await supabase.rpc(
              "calculate_conversion_metrics_with_monthly",
              {
                workspace_id: workspaceId, // Pass as string since JS BigInt isn't directly supported
              }
            );

            if (error) {
              console.error("Error calculating conversion metrics:", error);
              return res.status(400).json({ error: error.message });
            }
            return res.status(200).json(data[0]);
          } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        default:
          return res.status(400).json({ error: "Invalid action" });
      }
    }
    case "PUT": {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
      }
      const token = authHeader.split(" ")[1];

      switch (action) {
        case "updateWorkspaceStatus": {
          logger.debug(body);
          const { id: workspace_id, status } = body;
          const {
            data: { user },
          } = await supabase.auth.getUser(token);

          if (!user) {
            return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
          }

          if (!workspace_id) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          try {
            // First deactivate all workspaces for this user
            const { error: resetError } = await supabase
              .from("workspace_members")
              .update({ is_active: false })
              .eq("user_id", user.id);

            if (resetError) throw resetError;

            // Then activate only the specified workspace
            const { data: activated, error: activateError } = await supabase
              .from("workspace_members")
              .update({ is_active: status })
              .eq("user_id", user.id)
              .eq("workspace_id", workspace_id)
              .select(
                `
                workspace_id,
                role,
                workspaces (*)
              `
              )
              .single();
            logger.debug(activated);
            if (activateError) throw activateError;

            // Log workspace switch activity if status is true (activating)
            if (status && activated) {
              try {
                await ActivityLogger.logActivity({
                  workspace_id: workspace_id.toString(),
                  user_id: user.id,
                  member_email: user.email || '',
                  member_name: user.user_metadata?.name || user.user_metadata?.firstName,
                  activity_type: 'workspace_join' as any,
                  activity_description: `${user.email} switched to workspace: ${(activated.workspaces as any)?.name || 'Unknown'}`,
                  metadata: {
                    workspace_name: (activated.workspaces as any)?.name,
                    additional_info: {
                      member_role: activated.role,
                    },
                  },
                  ip_address: ActivityLogger.getClientIP(req),
                  user_agent: ActivityLogger.getUserAgent(req),
                });
              } catch (logError) {
                console.error('Failed to log workspace switch activity:', logError);
                // Don't fail the request if logging fails
              }
            }

            return res.status(200).json({
              message: "Workspace activated successfully",
              activated,
            });
          } catch (error) {
            console.error("Error setting active workspace:", error);
            return res
              .status(500)
              .json({ error: "Failed to set active workspace" });
          }
        }

        case "updateWorkspaceDetails": {
          const { id: workspace_id, data } = body;
          if (!workspace_id || !data || typeof data !== "object") {
            return res.status(400).json({
              error: "workspace_id and valid data object are required",
            });
          }

          try {
            const {
              data: { user },
            } = await supabase.auth.getUser(token);

            if (!user) {
              return res
                .status(401)
                .json({ error: AUTH_MESSAGES.UNAUTHORIZED });
            }

            // First check if workspace exists
            const { data: workspace, error: workspaceError } = await supabase
              .from("workspaces")
              .select("id, owner_id")
              .eq("id", workspace_id)
              .single();

            if (workspaceError || !workspace) {
              return res
                .status(404)
                .json({ error: "Workspace not found" });
            }

            // Check if user is owner or has admin privileges
            let hasPermission = false;
            let memberData: any = null;

            logger.debug("Permission check debug:", {
              workspace_id,
              workspace_owner_id: workspace.owner_id,
              user_id: user.id,
              user_email: user.email,
              isOwner: workspace.owner_id === user.id
            });

            // Check if user is the owner
            if (workspace.owner_id === user.id) {
              hasPermission = true;
              logger.debug("User is owner - permission granted");
            } else {
              // Check if user is an admin or super admin in this workspace
              // Use email as primary identifier since that's what the system uses
              const { data: memberDataResult, error: memberError } = await supabase
                .from("workspace_members")
                .select("role, user_id, email")
                .eq("workspace_id", workspace_id)
                .eq("email", user.email)
                .single();

              memberData = memberDataResult;

              logger.debug("Member lookup by email:", {
                user_email: user.email,
                memberData,
                memberError: memberError?.message
              });

              if (!memberError && memberData) {
                // Check for both lowercase and capitalized versions of roles
                const role = memberData.role?.toLowerCase();
                if (role === "admin" || role === "superadmin") {
                  hasPermission = true;
                  logger.debug("User has admin role - permission granted:", memberData.role);
                }
              }
              
              if (!hasPermission) {
                logger.debug("Permission check failed:", {
                  hasError: !!memberError,
                  hasMemberData: !!memberData,
                  role: memberData?.role,
                  normalizedRole: memberData?.role?.toLowerCase(),
                  isAdminOrSuperAdmin: memberData?.role?.toLowerCase() === "admin" || memberData?.role?.toLowerCase() === "superadmin"
                });
              }
            }

            // Final check: Is the user the one who created this workspace (added_by in workspace_members)?
            if (!hasPermission) {
              const { data: creatorCheck } = await supabase
                .from("workspace_members")
                .select("*")
                .eq("workspace_id", workspace_id)
                .eq("added_by", user.id)
                .eq("role", "SuperAdmin")
                .single();
                
              if (creatorCheck) {
                hasPermission = true;
                logger.debug("User is workspace creator - permission granted");
              }
            }

            if (!hasPermission) {
              console.error("Permission denied - no valid role found");
              console.error("Final permission state:", {
                workspace_id,
                user_id: user.id,
                user_email: user.email,
                isOwner: workspace.owner_id === user.id,
                memberRole: memberData?.role,
                hasPermission
              });
              return res
                .status(403)
                .json({ error: "You don't have permission to update this workspace" });
            }

            // Update the workspace with the data from the request body
            const updateWorkspace = await supabase
              .from("workspaces")
              .update(data)
              .eq("id", workspace_id);

            if (updateWorkspace.error) {
              throw new Error(updateWorkspace?.error?.message);
            }

            // Log workspace update activity
            try {
              await ActivityLogger.logActivity({
                workspace_id: workspace_id.toString(),
                user_id: user.id,
                member_email: user.email || '',
                member_name: user.user_metadata?.name || user.user_metadata?.firstName,
                activity_type: 'workspace_updated' as any,
                activity_description: `Workspace settings updated by ${user.email}`,
                metadata: {
                  workspace_name: data.name,
                  changes: data,
                },
                ip_address: ActivityLogger.getClientIP(req),
                user_agent: ActivityLogger.getUserAgent(req),
              });
            } catch (logError) {
              console.error('Failed to log workspace update activity:', logError);
            }

            return res.status(200).json({
              message: "Workspace updated successfully",
              data: updateWorkspace.data,
            });
          } catch (error: any) {
            console.error("Error updating workspace:", error.message);
            return res.status(500).json({ error: "Internal server error" });
          }
        }
        default:
          return res.status(400).json({ error: "Invalid action" });
      }
    }

    case "DELETE": {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
      }
      const token = authHeader.split(" ")[1];

      switch (action) {
        case "deleteWorkspace": {
          const { id: workspaceId } = body;

          if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
          }

          try {
            // Authenticate the user
            const {
              data: { user },
            } = await supabase.auth.getUser(token);

            if (!user) {
              return res.status(401).json({ error: AUTH_MESSAGES.UNAUTHORIZED });
            }

            // Get workspace details
            const { data: workspace, error: workspaceError } = await supabase
              .from("workspaces")
              .select("*")
              .eq("id", workspaceId)
              .single();

            if (workspaceError) {
              return res.status(404).json({ error: "Workspace not found" });
            }

            // Check if user is the workspace owner
            const isOwner = workspace.owner_id === user.id;

            // If not owner, check if user is SuperAdmin
            if (!isOwner) {
              const { data: memberData, error: memberError } = await supabase
                .from("workspace_members")
                .select("role")
                .eq("workspace_id", workspaceId)
                .eq("user_id", user.id)
                .single();

              if (memberError || !memberData) {
                return res.status(403).json({ 
                  error: "You don't have permission to delete this workspace" 
                });
              }

              // Only SuperAdmin can delete workspace (not regular admin)
              if (memberData.role !== "SuperAdmin") {
                return res.status(403).json({ 
                  error: "Only workspace owners and SuperAdmins can delete workspaces" 
                });
              }
            }

            // Log workspace deletion activity before deletion
            try {
              await ActivityLogger.logActivity({
                workspace_id: workspaceId.toString(),
                user_id: user.id,
                member_email: user.email || '',
                member_name: user.user_metadata?.name || user.user_metadata?.firstName,
                activity_type: ActivityType.WORKSPACE_LEAVE,
                activity_description: `Workspace "${workspace.name}" was deleted by ${user.email}`,
                metadata: {
                  workspace_name: workspace.name,
                  resource_type: 'workspace_deletion'
                },
                ip_address: ActivityLogger.getClientIP(req),
                user_agent: ActivityLogger.getUserAgent(req),
              });
            } catch (logError) {
              console.error('Failed to log workspace deletion activity:', logError);
              // Continue with deletion even if logging fails
            }

            // Start transaction-like deletion process
            // 1. Delete all workspace members
            const { error: membersError } = await supabase
              .from("workspace_members")
              .delete()
              .eq("workspace_id", workspaceId);

            if (membersError) {
              console.error("Error deleting workspace members:", membersError);
              return res.status(500).json({ 
                error: "Failed to delete workspace members" 
              });
            }

            // 2. Delete all leads associated with workspace
            const { error: leadsError } = await supabase
              .from("leads")
              .delete()
              .eq("work_id", workspaceId);

            if (leadsError) {
              console.error("Error deleting workspace leads:", leadsError);
              return res.status(500).json({ 
                error: "Failed to delete workspace leads" 
              });
            }

            // 3. Delete all webhooks associated with workspace
            const { error: webhooksError } = await supabase
              .from("webhooks")
              .delete()
              .eq("workspace_id", workspaceId);

            if (webhooksError) {
              console.error("Error deleting workspace webhooks:", webhooksError);
              return res.status(500).json({ 
                error: "Failed to delete workspace webhooks" 
              });
            }

            // 4. Delete all activity logs for workspace
            const { error: activityLogsError } = await supabase
              .from("member_activity_logs")
              .delete()
              .eq("workspace_id", workspaceId);

            if (activityLogsError) {
              console.error("Error deleting workspace activity logs:", activityLogsError);
              return res.status(500).json({ 
                error: "Failed to delete workspace activity logs" 
              });
            }

            // 5. Delete all status records for workspace
            const { error: statusError } = await supabase
              .from("status")
              .delete()
              .eq("work_id", workspaceId);

            if (statusError) {
              console.error("Error deleting workspace status records:", statusError);
              return res.status(500).json({ 
                error: "Failed to delete workspace status records" 
              });
            }

            // 6. Finally, delete the workspace itself
            const { error: workspaceDeleteError } = await supabase
              .from("workspaces")
              .delete()
              .eq("id", workspaceId);

            if (workspaceDeleteError) {
              console.error("Error deleting workspace:", workspaceDeleteError);
              return res.status(500).json({ 
                error: "Failed to delete workspace" 
              });
            }

            return res.status(200).json({ 
              message: "Workspace deleted successfully",
              deletedWorkspace: {
                id: workspaceId,
                name: workspace.name
              }
            });

          } catch (error: any) {
            console.error("Error in deleteWorkspace:", error);
            return res.status(500).json({ 
              error: "Internal server error",
              details: error.message 
            });
          }
        }

        default:
          return res.status(400).json({ error: "Invalid action" });
      }
    }

    default:
      return res.status(405).json({ error: "Method Not Allowed" });
  }
}
