export type InstagramPostType = "post" | "story" | "carousel";
export type InstagramPostStatus = "draft" | "scheduled" | "published" | "failed";

export interface InstagramProductTag {
  productoId: string;
  nombre: string;
  precio: number;
}

export interface InstagramPost {
  id: string;
  storeId: string;
  contentType: InstagramPostType;
  caption?: string;
  imageUrl?: string;
  productTags: InstagramProductTag[];
  status: InstagramPostStatus;
  scheduledFor?: string;
  publishedAt?: string;
  externalPostId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramPostMedia {
  id: string;
  postId: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  sortOrder: number;
}
