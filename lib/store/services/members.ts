import { membersApi } from "../base/members";

// Request Interfaces
interface Member {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "pending";
  profileImage?: string;
  name?: string;
}

interface AddMemberRequest {
  email: string;
  role: "admin" | "member";
  workspaceId: string;
  data: Member;
}

interface UpdateMemberRequest {
  id: string;
  workspaceId: string;
  updates: Partial<Member>;
}

interface DeleteMemberRequest {
  id: string;
  workspaceId: string;
}

interface UploadProfileImageRequest {
  memberId: string;
  workspaceId: string;
  imageFile: File;
}

interface ResendInviteRequest {
  memberId: any;
  workspaceId: string;
  email: string;
  status: any;
}

// Response Interfaces
interface MembersResponse {
  data: Member[];
  total: number;
}

interface AddMemberResponse {
  data: Member;
  message: string;
}

interface MemberRoleResponse {
  data: {
    role: string;
  };
}

interface UpdateMemberResponse {
  data: Member;
  message: string;
}

interface DeleteMemberResponse {
  message: string;
}

interface UploadProfileImageResponse {
  imageUrl: string;
  message: string;
}

// API Definition
export const memberApi = membersApi.injectEndpoints({
  endpoints: (builder) => ({
    getMembers: builder.query<MembersResponse, string>({
      query: (workspaceId) => ({
        url: `?action=getWorkspaceMembers&workspaceId=${workspaceId}`,
        method: "GET",
      }),
    }),

    // get member role
    getMemberRole: builder.query<MemberRoleResponse, string>({
      query: (workspaceId) => ({
        url: `?action=getMemberRole&workspaceId=${workspaceId}`,
        method: "GET",
      }),
    }),

    // Add a new member
    addMember: builder.mutation<AddMemberResponse, any>({
      query: ({ workspaceId, ...body }) => ({
        url: `?action=addMember&workspaceId=${workspaceId}`,
        method: "POST",
        body,
      }),
    }),

    updateMember: builder.mutation<UpdateMemberResponse, UpdateMemberRequest>({
      query: ({ workspaceId, id, updates }) => ({
        url: `?action=updateMemberRole&workspaceId=${workspaceId}&memberId=${id}`,
        method: "PUT",
        body: updates, // { role: "newRole" }
      }),
    }),

    // Delete a member
    deleteMember: builder.mutation<DeleteMemberResponse, DeleteMemberRequest>({
      query: ({ workspaceId, id }) => ({
        url: `?action=removeMember&workspaceId=${workspaceId}&id=${id}`,
        method: "DELETE",
      }),
    }),

    // Upload profile image
    uploadProfileImage: builder.mutation<
      UploadProfileImageResponse,
      UploadProfileImageRequest
    >({
      query: ({ workspaceId, memberId, imageFile }) => {
        const formData = new FormData();
        formData.append("image", imageFile);

        return {
          url: `workspace/${workspaceId}/members/${memberId}/profile-image`,
          method: "POST",
          body: formData,
        };
      },
    }),

    // Resend invitation
    resendInvite: builder.mutation<{ message: string }, ResendInviteRequest>({
      query: ({ workspaceId, memberId, email, status }) => ({
        url: `?action=resendInvitation&workspaceId=${workspaceId}&id=${memberId}&email=${email} &status=${status}`,
        method: "POST",
      }),
    }),
  }),
});

// Export hooks for usage in components
export const {
  useGetMembersQuery,
  useGetMemberRoleQuery,
  useAddMemberMutation,
  useUpdateMemberMutation,
  useDeleteMemberMutation,
  useUploadProfileImageMutation,
  useResendInviteMutation,
} = memberApi;
